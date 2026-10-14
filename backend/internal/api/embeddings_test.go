package api

import "testing"

func TestPrefixEmbeddingText(t *testing.T) {
	if got, err := prefixEmbeddingText("как дела", "query"); err != nil || got != "query: как дела" {
		t.Fatalf("query prefix = %q", got)
	}
	if got, err := prefixEmbeddingText("важный факт", "passage"); err != nil || got != "passage: важный факт" {
		t.Fatalf("passage prefix = %q", got)
	}
	if got, err := prefixEmbeddingText("старый клиент", ""); err != nil || got != "passage: старый клиент" {
		t.Fatalf("compatibility prefix = %q", got)
	}
	if got, err := prefixEmbeddingText("query: уже готово", "passage"); err != nil || got != "query: уже готово" {
		t.Fatalf("existing prefix = %q", got)
	}
	if _, err := prefixEmbeddingText("опечатка", "qurey"); err == nil {
		t.Fatal("expected unsupported input_type to be rejected")
	}
}
