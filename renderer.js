// renderer.js

// Global variables for tokens and file selections
let sourceToken = null;
let destToken = null;
let selectedSourceFile = null;
let selectedDestFile = null;

const clientId = "1002733101410-bjudg86hd9smfnefsn04mots6tbrfl4t.apps.googleusercontent.com"; // Your Client ID

// Update status and UI elements
function updateStatus(message, elementId = "status-message") {
    console.log(`Status: ${message}`); // Debug log
    document.getElementById(elementId).textContent = `Status: ${message}`;
}

function updateConnectionStatus(drive, connected) {
    const statusElement = document.getElementById(`gdrive${drive}-status`);
    const connectBtn = document.getElementById(`connect-gdrive${drive}`);
    const disconnectBtn = document.getElementById(`disconnect-gdrive${drive}`);
    const upBtn = document.getElementById(`gdrive${drive}-up`);

    statusElement.className = `status ${connected ? 'connected' : 'disconnected'}`;
    statusElement.textContent = connected ? `Connected` : `Not Connected`;
    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
    upBtn.disabled = !connected;
    console.log(`Drive ${drive} connection status: ${connected ? 'Connected' : 'Disconnected'}`);
}

// Handle OAuth authentication
function authenticate(drive) {
    console.log(`Attempting to authenticate Drive ${drive}`);
    const redirectUri = window.location.origin;
    const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=https://www.googleapis.com/auth/drive&state=${drive}`;
    window.location.href = authUrl;
}

// Process OAuth redirect
function handleOAuthRedirect() {
    console.log("Checking hash:", window.location.hash);
    const hash = window.location.hash;
    if (hash) {
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get("access_token");
        const state = params.get("state");
        if (token && state) {
            console.log(`Received token for Drive ${state}:`, token);
            if (state === "A") {
                sourceToken = token;
                updateConnectionStatus("A", true);
                updateStatus("Drive A authenticated", "gdriveA-status");
                listFiles("A", sourceToken);
            } else if (state === "B") {
                destToken = token;
                updateConnectionStatus("B", true);
                updateStatus("Drive B authenticated", "gdriveB-status");
                listFiles("B", destToken);
            }
            window.location.hash = ""; // Clear hash after processing
        } else {
            console.log("No token or state in hash:", hash);
        }
    } else {
        console.log("No hash present");
    }
}

// Set up handlers and check hash immediately
console.log("Setting up handlers");
document.getElementById("connect-gdriveA").onclick = () => {
    console.log("Connect GDrive A clicked");
    authenticate("A");
};
document.getElementById("connect-gdriveB").onclick = () => {
    console.log("Connect GDrive B clicked");
    authenticate("B");
};

document.getElementById("disconnect-gdriveA").onclick = () => {
    sourceToken = null;
    updateConnectionStatus("A", false);
    updateStatus("Drive A disconnected", "gdriveA-status");
    document.getElementById("gdriveA-files").innerHTML = "No files found.";
    console.log("Drive A disconnected");
};
document.getElementById("disconnect-gdriveB").onclick = () => {
    destToken = null;
    updateConnectionStatus("B", false);
    updateStatus("Drive B disconnected", "gdriveB-status");
    document.getElementById("gdriveB-files").innerHTML = "No files found.";
    console.log("Drive B disconnected");
};

document.getElementById("gdriveA-up").onclick = () => console.log("Up clicked for Drive A");
document.getElementById("gdriveB-up").onclick = () => console.log("Up clicked for Drive B");

document.getElementById("transfer-file").onclick = () => {
    console.log("Transfer button clicked");
    if (sourceToken && destToken && selectedSourceFile) {
        startTransfer(sourceToken, destToken, selectedSourceFile, "/");
        updateStatus(`Transferring ${selectedSourceFile} to /...`);
    } else {
        updateStatus("Please connect both drives and select a file from Drive A");
    }
};

// List files from Google Drive using rclone WebAssembly
async function listFiles(drive, token) {
    console.log(`Listing files for Drive ${drive} with token: ${token.substring(0, 5)}...`);
    try {
        if (!window.listFiles) {
            console.error("listFiles function not available in WebAssembly");
            updateStatus(`WebAssembly error: listFiles not loaded`, `gdrive${drive}-status`);
            return;
        }
        console.log("Calling window.listFiles with:", drive, token.substring(0, 5) + "...", "");
        const result = await window.listFiles(drive, token, "");
        console.log("listFiles raw result:", result);
        if (result === undefined || result === null) {
            console.error(`No response from listFiles for Drive ${drive}`);
            updateStatus(`Error listing files for Drive ${drive}: No response from WebAssembly`, `gdrive${drive}-status`);
            return;
        }
        if (typeof result !== 'object') {
            console.error(`Unexpected response type from listFiles for Drive ${drive}:`, typeof result, result);
            updateStatus(`Error listing files for Drive ${drive}: Unexpected response type (${typeof result})`, `gdrive${drive}-status`);
            return;
        }
        const files = Array.isArray(result.files) ? result.files : (result.files ? [result.files] : []);
        const fileList = document.getElementById(`gdrive${drive}-files`);
        fileList.innerHTML = files.length ? files.map(file => `<div onclick="selectFile('${drive}', '${file}')">${file}</div>`).join("\n") : "No files found.";
        if (result.error) {
            console.error(`Error listing files for Drive ${drive}:`, result.error);
            updateStatus(`Error listing files for Drive ${drive}: ${result.error}`, `gdrive${drive}-status`);
        }
    } catch (error) {
        console.error(`Error listing files for Drive ${drive}:`, error);
        updateStatus(`Error listing files for Drive ${drive}: ${error}`, `gdrive${drive}-status`);
    }
}

// Select a file from the list
function selectFile(drive, file) {
    if (drive === "A") {
        selectedSourceFile = file;
        updateStatus(`Selected ${file} from Drive A`);
        document.getElementById("transfer-file").disabled = false;
    } else if (drive === "B") {
        selectedDestFile = file;
        updateStatus(`Selected ${file} in Drive B`);
    }
    document.getElementById("gdriveA-files").querySelectorAll("div").forEach(div => div.style.backgroundColor = "");
    document.getElementById("gdriveB-files").querySelectorAll("div").forEach(div => div.style.backgroundColor = "");
    document.getElementById(`gdrive${drive}-files`).querySelector(`div:contains(${file})`).style.backgroundColor = "#e0e0e0";
    console.log(`Selected ${file} in Drive ${drive}`);
}

// Start transfer using rclone WebAssembly
function startTransfer(sourceToken, destToken, srcPath, dstPath) {
    console.log(`Starting transfer from ${srcPath} to ${dstPath}`);
    if (window.startTransfer) {
        const result = window.startTransfer(sourceToken, destToken, srcPath, dstPath);
        updateStatus(`Transferring ${srcPath} to ${dstPath}... ${result || 'Started'}`);
    } else {
        console.error("startTransfer function not available in WebAssembly");
        updateStatus("WebAssembly module not loaded or startTransfer not available");
    }
}

// Run immediately on load
handleOAuthRedirect();