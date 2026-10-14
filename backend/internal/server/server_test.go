package server

import "testing"

func TestLoopbackAddress(t *testing.T) {
	t.Parallel()

	if got, want := loopbackAddress("8080"), "127.0.0.1:8080"; got != want {
		t.Fatalf("loopbackAddress() = %q, want %q", got, want)
	}
}
