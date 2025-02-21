package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"syscall/js"

	_ "github.com/rclone/rclone/backend/drive" // Import Google Drive backend
	"github.com/rclone/rclone/fs"
	rcloneConfig "github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
	"github.com/rclone/rclone/fs/operations"
)

// Custom HTTP transport for WebAssembly
type jsRoundTripper struct{}

func (t *jsRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	ch := make(chan struct {
		resp *http.Response
		err  error
	})

	headers := js.Global().Get("Object").New()
	for key, values := range req.Header {
		for _, value := range values {
			headers.Set(key, value)
		}
	}

	// Use fetch via JS
	js.Global().Get("fetch").Invoke(req.URL.String(), js.ValueOf(map[string]interface{}{
		"method":  req.Method,
		"headers": headers,
	})).Call("then", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		resp := args[0]
		status := resp.Get("status").Int()
		resp.Call("text").Call("then", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
			body := args[0].String()
			response := &http.Response{
				StatusCode: status,
				Body:       io.NopCloser(strings.NewReader(body)),
				Header:     make(http.Header),
			}
			ch <- struct {
				resp *http.Response
				err  error
			}{response, nil}
			return nil
		}))
		return nil
	})).Call("catch", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		ch <- struct {
			resp *http.Response
			err  error
		}{nil, fmt.Errorf(args[0].String())}
		return nil
	}))

	result := <-ch
	return result.resp, result.err
}

func init() {
	// Use in-memory config only
	rcloneConfig.SetConfigPath("")
	configfile.Install()
}

func main() {
	http.DefaultClient.Transport = &jsRoundTripper{}
	rcloneCfg := fs.GetConfig(context.Background())
	rcloneCfg.LogLevel = fs.LogLevelInfo

	fmt.Println("WASM: rclone init complete.")

	// Expose listFiles(driveName, accessToken, path)
	js.Global().Set("listFiles", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		ctx := context.Background()
		remoteName := args[0].String()
		accessToken := args[1].String()
		remotePath := args[2].String()

		fmt.Println("Listing files for", remoteName, "at path", remotePath)

		// Configure "remoteName" as Google Drive
		rcloneConfig.FileSet(remoteName, "type", "drive")
		rcloneConfig.FileSet(remoteName, "token", fmt.Sprintf(`{"access_token":"%s"}`, accessToken))

		fsys, err := fs.NewFs(ctx, fmt.Sprintf("%s:%s", remoteName, remotePath))
		if err != nil {
			fmt.Println("Error creating filesystem:", err)
			return js.ValueOf(map[string]interface{}{
				"error": fmt.Sprintf("Error creating filesystem: %v", err),
			})
		}

		entries, err := fsys.List(ctx, "")
		if err != nil {
			fmt.Println("Error listing files:", err)
			return js.ValueOf(map[string]interface{}{
				"error": fmt.Sprintf("Error listing: %v", err),
			})
		}

		var fileNames []interface{}
		for _, entry := range entries {
			fileNames = append(fileNames, entry.Remote())
			fmt.Println("Found file:", entry.Remote())
		}

		return js.ValueOf(map[string]interface{}{
			"files": fileNames,
		})
	}))

	// Expose startTransfer(sourceToken, destToken, srcPath, dstPath)
	js.Global().Set("startTransfer", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		ctx := context.Background()
		sourceToken := args[0].String()
		destToken := args[1].String()
		srcPath := args[2].String()
		dstPath := args[3].String()

		// Configure "source" remote
		rcloneConfig.FileSet("source", "type", "drive")
		rcloneConfig.FileSet("source", "token", fmt.Sprintf(`{"access_token":"%s"}`, sourceToken))

		// Configure "destination" remote
		rcloneConfig.FileSet("destination", "type", "drive")
		rcloneConfig.FileSet("destination", "token", fmt.Sprintf(`{"access_token":"%s"}`, destToken))

		srcFs, err := fs.NewFs(ctx, "source:"+srcPath)
		if err != nil {
			errMsg := fmt.Sprintf("Source error: %v", err)
			fmt.Println(errMsg)
			return js.ValueOf(errMsg)
		}

		dstFs, err := fs.NewFs(ctx, "destination:"+dstPath)
		if err != nil {
			errMsg := fmt.Sprintf("Destination error: %v", err)
			fmt.Println(errMsg)
			return js.ValueOf(errMsg)
		}

		// Copy a single file. For a full directory, you'd do CopyDir.
		err = operations.CopyFile(ctx, dstFs, srcFs, srcPath, dstPath)
		if err != nil {
			errMsg := fmt.Sprintf("Transfer error: %v", err)
			fmt.Println(errMsg)
			return js.ValueOf(errMsg)
		}

		successMsg := "Transfer complete."
		fmt.Println(successMsg)
		return js.ValueOf(successMsg)
	}))

	// Keep the WASM runtime alive
	select {}
}
