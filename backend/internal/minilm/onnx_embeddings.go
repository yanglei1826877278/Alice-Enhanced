package minilm

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sugarme/tokenizer"
	"github.com/sugarme/tokenizer/pretrained"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	defaultModelName  = "intfloat/multilingual-e5-small"
	defaultMaxLen     = 512
	queryPrefix       = "query: "
	passagePrefix     = "passage: "
	modelFileName     = "multilingual-e5-small.onnx"
	tokenizerFileName = "multilingual-e5-small-tokenizer.json"
	modelRevision     = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
	modelSHA256       = "4654c156f3e4171abc9c716cdb771bf9116455d15ac1aab364aeeede0e3205b0"
	tokenizerSHA256   = "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"
)

// OnnxEmbeddingService provides multilingual text embeddings using ONNX Runtime
// and the Hugging Face tokenizer JSON format. Tokenization stays in Go so the
// desktop app does not require Python or PyTorch.
type OnnxEmbeddingService struct {
	mu          sync.RWMutex
	inferenceMu sync.Mutex
	ready       bool
	config      *Config
	info        *ServiceInfo
	tokenizer   *tokenizer.Tokenizer
	session     *ort.DynamicAdvancedSession
	maxLen      int
}

// Ensure OnnxEmbeddingService implements EmbeddingProvider
var _ EmbeddingProvider = (*OnnxEmbeddingService)(nil)

// NewOnnxEmbeddingService creates a new ONNX-based embedding service
func NewOnnxEmbeddingService(config *Config) *OnnxEmbeddingService {
	modelName := config.ModelName
	if modelName == "" {
		modelName = defaultModelName
	}
	maxLen := config.MaxLen
	if maxLen <= 0 {
		maxLen = defaultMaxLen
	}
	return &OnnxEmbeddingService{
		config: config,
		maxLen: maxLen,
		info: &ServiceInfo{
			Name:        "ONNX multilingual embeddings",
			Version:     "3.0.0",
			Status:      "initializing",
			Model:       modelName,
			Dimension:   config.Dimension,
			LastUpdated: time.Now(),
			Metadata:    make(map[string]string),
		},
	}
}

// Initialize initializes the ONNX embeddings service
func (s *OnnxEmbeddingService) Initialize(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("Initializing ONNX embeddings service (%s)...", s.info.Model)

	// Ensure runtime and model files
	if err := s.ensureRuntimeAndModel(); err != nil {
		return fmt.Errorf("failed to ensure runtime and model: %w", err)
	}

	// Initialize ONNX session
	if err := s.initSession(); err != nil {
		return fmt.Errorf("failed to initialize session: %w", err)
	}

	s.ready = true
	s.info.Status = "ready"
	s.info.LastUpdated = time.Now()
	s.info.Metadata["onnx_runtime"] = "enabled"
	s.info.Metadata["tokenizer"] = "huggingface_tokenizer_json"
	s.info.Metadata["input_prefixes"] = "query:/passage:"
	s.info.Metadata["max_length"] = fmt.Sprintf("%d", s.maxLen)

	log.Println("ONNX embeddings service initialized successfully")
	return nil
}

func (s *OnnxEmbeddingService) ensureRuntimeAndModel() error {
	// Ensure model directory
	if err := os.MkdirAll(s.config.ModelPath, 0o755); err != nil {
		return err
	}

	// Download ORT shared library
	libPath, err := ensureORTSharedLib()
	if err != nil {
		return fmt.Errorf("onnxruntime lib: %w", err)
	}

	// Point onnxruntime_go to the shared library
	ort.SetSharedLibraryPath(libPath)

	// Download the pinned multilingual model and tokenizer.
	_, tokenizerPath, err := ensureMiniLMModel(s.config.ModelPath)
	if err != nil {
		return err
	}
	if s.config.TokenizerPath != "" {
		tokenizerPath = s.config.TokenizerPath
	}

	tk, err := pretrained.FromFile(tokenizerPath)
	if err != nil {
		return fmt.Errorf("load tokenizer: %w", err)
	}
	s.tokenizer = tk
	return nil
}

func (s *OnnxEmbeddingService) initSession() error {
	if err := ort.InitializeEnvironment(); err != nil {
		return err
	}

	// Input and output names we expect
	inNames := []string{"input_ids", "attention_mask", "token_type_ids"}
	outNames := []string{"last_hidden_state"}

	modelPath := filepath.Join(s.config.ModelPath, modelFileName)
	sess, err := ort.NewDynamicAdvancedSession(modelPath, inNames, outNames, nil)
	if err != nil {
		return err
	}
	s.session = sess
	return nil
}

// IsReady returns true if the service is ready
func (s *OnnxEmbeddingService) IsReady() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ready
}

// GetInfo returns service information
func (s *OnnxEmbeddingService) GetInfo() *ServiceInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	info := *s.info
	info.LastUpdated = time.Now()
	return &info
}

// GenerateEmbedding generates a single embedding using ONNX Runtime
func (s *OnnxEmbeddingService) GenerateEmbedding(ctx context.Context, text string) ([]float32, error) {
	if !s.IsReady() {
		return nil, fmt.Errorf("embeddings service is not ready")
	}

	if text == "" {
		return nil, fmt.Errorf("text cannot be empty")
	}

	// Use batch function with single text
	embeddings, err := s.GenerateEmbeddings(ctx, []string{text})
	if err != nil {
		return nil, err
	}

	return embeddings[0], nil
}

// GenerateEmbeddings generates multiple embeddings
func (s *OnnxEmbeddingService) GenerateEmbeddings(ctx context.Context, texts []string) ([][]float32, error) {
	if !s.IsReady() {
		return nil, fmt.Errorf("embeddings service is not ready")
	}

	if len(texts) == 0 {
		return nil, fmt.Errorf("texts cannot be empty")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	// Serialize tokenizer/session access. Both the tokenizer and ORT session
	// contain mutable state and are shared by all HTTP requests.
	s.inferenceMu.Lock()
	defer s.inferenceMu.Unlock()

	// Tokenize all texts
	ids, masks, err := s.batchTokenize(texts, s.maxLen)
	if err != nil {
		return nil, err
	}

	// Create tensors
	bsz := len(texts)
	seq := 1
	for _, mask := range masks {
		for i, value := range mask {
			if value != 0 && i+1 > seq {
				seq = i + 1
			}
		}
	}
	inputIDs := make([]int64, bsz*seq)
	attMask := make([]int64, bsz*seq)

	for i := 0; i < bsz; i++ {
		copy(inputIDs[i*seq:(i+1)*seq], ids[i][:seq])
		copy(attMask[i*seq:(i+1)*seq], masks[i][:seq])
	}

	in1, err := ort.NewTensor[int64](ort.NewShape(int64(bsz), int64(seq)), inputIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to create input tensor: %w", err)
	}
	defer in1.Destroy()

	in2, err := ort.NewTensor[int64](ort.NewShape(int64(bsz), int64(seq)), attMask)
	if err != nil {
		return nil, fmt.Errorf("failed to create attention tensor: %w", err)
	}
	defer in2.Destroy()

	// Token type IDs (all zeros)
	ttiData := make([]int64, bsz*seq)
	tti, err := ort.NewTensor[int64](ort.NewShape(int64(bsz), int64(seq)), ttiData)
	if err != nil {
		return nil, fmt.Errorf("failed to create token type tensor: %w", err)
	}
	defer tti.Destroy()

	inputsVals := []ort.Value{in1, in2, tti}
	outputsVals := make([]ort.Value, 1)

	if err := s.session.Run(inputsVals, outputsVals); err != nil {
		return nil, fmt.Errorf("ONNX inference failed: %w", err)
	}

	// Process output
	out0 := outputsVals[0]
	t, ok := out0.(*ort.Tensor[float32])
	if !ok {
		return nil, errors.New("unexpected output type")
	}

	dataF := t.GetData()
	shape := t.GetShape()
	if len(shape) != 3 {
		return nil, fmt.Errorf("unexpected output shape: %v", shape)
	}

	seqLen := int(shape[1])
	hiddenSize := int(shape[2])

	// Mean pooling with attention mask
	out := make([][]float32, bsz)
	for i := 0; i < bsz; i++ {
		start := i * seqLen * hiddenSize
		vec := make([]float32, hiddenSize)
		var count float32

		for j := 0; j < seqLen; j++ {
			if attMask[i*seq+j] == 0 {
				continue
			}
			base := start + j*hiddenSize
			for d := 0; d < hiddenSize; d++ {
				vec[d] += dataF[base+d]
			}
			count += 1
		}

		if count > 0 {
			inv := 1.0 / count
			var norm float64
			for d := 0; d < hiddenSize; d++ {
				vec[d] *= float32(inv)
				norm += float64(vec[d] * vec[d])
			}
			if norm > 0 {
				invn := float32(1.0 / math.Sqrt(norm))
				for d := 0; d < hiddenSize; d++ {
					vec[d] *= invn
				}
			}
		}
		out[i] = vec
	}

	return out, nil
}

// batchTokenize tokenizes multiple texts
func (s *OnnxEmbeddingService) batchTokenize(texts []string, maxLen int) ([][]int64, [][]int64, error) {
	ids := make([][]int64, len(texts))
	masks := make([][]int64, len(texts))
	for i, t := range texts {
		ii, mm, err := s.encode(t, maxLen)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to tokenize input %d: %w", i, err)
		}
		ids[i], masks[i] = ii, mm
	}
	return ids, masks, nil
}

func (s *OnnxEmbeddingService) encode(text string, maxLen int) ([]int64, []int64, error) {
	encoding, err := s.tokenizer.EncodeSingle(text, true)
	if err != nil {
		return nil, nil, fmt.Errorf("tokenizer encode failed: %w", err)
	}
	if encoding == nil {
		return nil, nil, errors.New("tokenizer returned no encoding")
	}
	seq := encoding.Ids
	if len(seq) > maxLen {
		seq = seq[:maxLen]
	}
	ids := make([]int64, maxLen)
	mask := make([]int64, maxLen)
	for i, v := range seq {
		ids[i] = int64(v)
		mask[i] = 1
	}
	return ids, mask, nil
}

// ComputeSimilarity computes cosine similarity between two embeddings
func (s *OnnxEmbeddingService) ComputeSimilarity(ctx context.Context, embedding1, embedding2 []float32) (float32, error) {
	if len(embedding1) != len(embedding2) {
		return 0, fmt.Errorf("embeddings must have the same dimension")
	}

	if len(embedding1) == 0 {
		return 0, fmt.Errorf("embeddings cannot be empty")
	}

	// Compute dot product (cosine similarity for normalized vectors)
	dotProduct := float32(0)
	for i := range embedding1 {
		dotProduct += embedding1[i] * embedding2[i]
	}

	return dotProduct, nil
}

// SearchSimilar finds similar embeddings
func (s *OnnxEmbeddingService) SearchSimilar(ctx context.Context, queryEmbedding []float32, candidateEmbeddings [][]float32, topK int) ([]int, []float32, error) {
	if len(queryEmbedding) == 0 {
		return nil, nil, fmt.Errorf("query embedding cannot be empty")
	}

	if len(candidateEmbeddings) == 0 {
		return nil, nil, fmt.Errorf("candidate embeddings cannot be empty")
	}

	if topK <= 0 {
		topK = 5
	}

	// Compute similarities
	similarities := make([]float32, len(candidateEmbeddings))
	indices := make([]int, len(candidateEmbeddings))

	for i, candidate := range candidateEmbeddings {
		similarity, err := s.ComputeSimilarity(ctx, queryEmbedding, candidate)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to compute similarity for candidate %d: %w", i, err)
		}
		similarities[i] = similarity
		indices[i] = i
	}

	// Sort by similarity (descending)
	for i := 0; i < len(similarities)-1; i++ {
		for j := i + 1; j < len(similarities); j++ {
			if similarities[i] < similarities[j] {
				similarities[i], similarities[j] = similarities[j], similarities[i]
				indices[i], indices[j] = indices[j], indices[i]
			}
		}
	}

	// Return top K
	if topK > len(similarities) {
		topK = len(similarities)
	}

	return indices[:topK], similarities[:topK], nil
}

// Shutdown gracefully shuts down the embeddings service
func (s *OnnxEmbeddingService) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.session != nil {
		s.session.Destroy()
		s.session = nil
	}

	// Clean up ONNX Runtime environment
	ort.DestroyEnvironment()

	s.ready = false
	s.info.Status = "stopped"
	s.info.LastUpdated = time.Now()

	log.Println("ONNX embeddings service shutdown completed")
	return nil
}

// Downloads and model management (adapted from GoLLMCore)

func ensureMiniLMModel(dir string) (modelPath, tokenizerPath string, err error) {
	modelPath = filepath.Join(dir, modelFileName)
	tokenizerPath = filepath.Join(dir, tokenizerFileName)
	baseURL := "https://huggingface.co/" + defaultModelName + "/resolve/" + modelRevision + "/onnx/"

	if err = ensurePinnedArtifact(
		modelPath,
		[]string{baseURL + "model_O4.onnx"},
		modelSHA256,
		600*time.Second,
	); err != nil {
		return "", "", fmt.Errorf("ensure multilingual ONNX model: %w", err)
	}

	if err = ensurePinnedArtifact(
		tokenizerPath,
		[]string{baseURL + "tokenizer.json"},
		tokenizerSHA256,
		120*time.Second,
	); err != nil {
		return "", "", fmt.Errorf("ensure multilingual tokenizer: %w", err)
	}

	return modelPath, tokenizerPath, nil
}

func ensurePinnedArtifact(path string, urls []string, expectedSHA256 string, timeout time.Duration) error {
	if fileExists(path) {
		actual, err := sha256File(path)
		if err == nil && actual == expectedSHA256 {
			return nil
		}
		if err != nil {
			log.Printf("Unable to verify embedding artifact %s: %v; redownloading", path, err)
		} else {
			log.Printf("Checksum mismatch for embedding artifact %s; redownloading", path)
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}

	tmpPath := path + ".download"
	if err := os.Remove(tmpPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := tryDownload(urls, tmpPath, 3, timeout); err != nil {
		return err
	}
	actual, err := sha256File(tmpPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if actual != expectedSHA256 {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("checksum mismatch: got %s, want %s", actual, expectedSHA256)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

func ensureORTSharedLib() (string, error) {
	baseDir := filepath.Join(os.TempDir(), "onnxruntime")
	if componentsDir := os.Getenv("ALICE_COMPONENTS_DIR"); componentsDir != "" {
		baseDir = filepath.Join(componentsDir, "runtime", "onnxruntime")
	}
	ortVersion := "v1.22.0"
	versionDir := filepath.Join(baseDir, ortVersion)
	if err := os.MkdirAll(versionDir, 0o755); err != nil {
		return "", err
	}

	switch runtime.GOOS {
	case "windows":
		dll := filepath.Join(versionDir, "onnxruntime.dll")
		if fileExists(dll) {
			return dll, nil
		}
		urls := []string{
			"https://github.com/microsoft/onnxruntime/releases/download/" + ortVersion + "/onnxruntime-win-x64-" + strings.TrimPrefix(ortVersion, "v") + ".zip",
		}
		zipPath := filepath.Join(versionDir, "ort.zip")
		if err := tryDownload(urls, zipPath, 3, 240*time.Second); err != nil {
			return "", err
		}
		if err := unzipOne(zipPath, versionDir, "onnxruntime.dll"); err != nil {
			return "", err
		}
		return dll, nil

	case "darwin":
		dylib := filepath.Join(versionDir, "libonnxruntime.dylib")
		if fileExists(dylib) {
			return dylib, nil
		}
		// arm64 vs x64 both extract libonnxruntime.dylib
		urls := []string{
			"https://github.com/microsoft/onnxruntime/releases/download/" + ortVersion + "/onnxruntime-osx-universal2-" + strings.TrimPrefix(ortVersion, "v") + ".tgz",
			"https://github.com/microsoft/onnxruntime/releases/download/" + ortVersion + "/onnxruntime-osx-arm64-" + strings.TrimPrefix(ortVersion, "v") + ".tgz",
			"https://github.com/microsoft/onnxruntime/releases/download/" + ortVersion + "/onnxruntime-osx-x64-" + strings.TrimPrefix(ortVersion, "v") + ".tgz",
		}
		tgz := filepath.Join(versionDir, "ort.tgz")
		if err := tryDownload(urls, tgz, 3, 240*time.Second); err != nil {
			return "", err
		}
		if err := untarSelect(tgz, versionDir, []string{"libonnxruntime.dylib"}); err != nil {
			return "", err
		}
		return dylib, nil

	case "linux":
		so := filepath.Join(versionDir, "libonnxruntime.so")
		if fileExists(so) {
			return so, nil
		}
		urls := []string{
			"https://github.com/microsoft/onnxruntime/releases/download/" + ortVersion + "/onnxruntime-linux-x64-" + strings.TrimPrefix(ortVersion, "v") + ".tgz",
		}
		tgz := filepath.Join(versionDir, "ort.tgz")
		if err := tryDownload(urls, tgz, 3, 240*time.Second); err != nil {
			return "", err
		}
		if err := untarSelect(tgz, versionDir, []string{"libonnxruntime.so"}); err != nil {
			return "", err
		}
		return so, nil

	default:
		return "", fmt.Errorf("unsupported platform for ORT: %s", runtime.GOOS)
	}
}

func tryDownload(urls []string, dst string, retries int, timeout time.Duration) error {
	var last error
	for i, u := range urls {
		log.Printf("Downloading: %s (%d/%d)", u, i+1, len(urls))
		if err := downloadFile(u, dst, timeout); err != nil {
			last = err
			continue
		}
		return nil
	}
	return last
}

func downloadFile(url, dst string, timeout time.Duration) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "AliceAI/1.0")
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("bad status: %s", resp.Status)
	}
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		return err
	}
	out.Close()
	return os.Rename(tmp, dst)
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir() && info.Size() > 0
}

// unzipOne extracts a specific file from a zip archive to dstDir
func unzipOne(zipPath, dstDir, wanted string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		if filepath.Base(f.Name) == wanted {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			defer rc.Close()
			out := filepath.Join(dstDir, wanted)
			fo, err := os.Create(out)
			if err != nil {
				return err
			}
			if _, err := io.Copy(fo, rc); err != nil {
				fo.Close()
				return err
			}
			fo.Close()
			if runtime.GOOS != "windows" {
				_ = os.Chmod(out, 0o755)
			}
			return nil
		}
	}
	return fmt.Errorf("file %s not found in zip", wanted)
}

// untarSelect extracts specific files from a .tgz into dstDir
func untarSelect(tgzPath, dstDir string, names []string) error {
	set := make(map[string]bool)
	for _, n := range names {
		set[n] = true
	}
	f, err := os.Open(tgzPath)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		base := filepath.Base(hdr.Name)
		wanted, ok := selectedTarOutputName(hdr.Name, base, set)
		if !ok || hdr.FileInfo().IsDir() || hdr.Typeflag != tar.TypeReg {
			continue
		}
		out := filepath.Join(dstDir, wanted)
		of, err := os.Create(out)
		if err != nil {
			return err
		}
		if _, err := io.Copy(of, tr); err != nil {
			of.Close()
			return err
		}
		of.Close()
		if runtime.GOOS != "windows" {
			_ = os.Chmod(out, 0o755)
		}
		delete(set, wanted)
		if len(set) == 0 {
			break
		}
	}
	if len(set) > 0 {
		return fmt.Errorf("missing files: %v", keys(set))
	}
	return nil
}

func selectedTarOutputName(entryName, base string, set map[string]bool) (string, bool) {
	if set[base] {
		return base, true
	}

	if strings.Contains(entryName, ".dSYM/") {
		return "", false
	}

	for wanted := range set {
		if isVersionedSharedLibraryName(wanted, base) {
			return wanted, true
		}
	}
	return "", false
}

func isVersionedSharedLibraryName(wanted, candidate string) bool {
	if strings.HasSuffix(wanted, ".dylib") {
		prefix := strings.TrimSuffix(wanted, ".dylib") + "."
		return strings.HasPrefix(candidate, prefix) && strings.HasSuffix(candidate, ".dylib")
	}
	if strings.HasSuffix(wanted, ".so") {
		prefix := wanted + "."
		return strings.HasPrefix(candidate, prefix)
	}
	return false
}

func keys(m map[string]bool) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}
