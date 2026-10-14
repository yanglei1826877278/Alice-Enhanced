package minilm

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/sugarme/tokenizer/pretrained"
)

func TestMultilingualTokenizerEncodesCyrillic(t *testing.T) {
	path := filepath.Join("..", "..", "models", "minilm", tokenizerFileName)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("multilingual tokenizer artifact is not installed: %v", err)
	}
	tk, err := pretrained.FromFile(path)
	if err != nil {
		t.Fatalf("load multilingual tokenizer: %v", err)
	}

	encoding, err := tk.EncodeSingle("query: привет, это русский текст", true)
	if err != nil {
		t.Fatalf("encode Russian text: %v", err)
	}
	if len(encoding.Ids) < 5 {
		t.Fatalf("expected special tokens and Cyrillic pieces, got %v", encoding.Ids)
	}
	for _, id := range encoding.Ids {
		if id == 3 { // XLM-R <unk>
			t.Fatalf("Russian text produced an unknown token: %v", encoding.Ids)
		}
	}
}
