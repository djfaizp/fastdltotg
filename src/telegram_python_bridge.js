import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the Python bridge script
const PYTHON_BRIDGE_PATH = path.join(__dirname, 'telegram_bridge.py');

/**
 * Execute a command on the Python bridge
 * @param {Object} params - Parameters to pass to the Python bridge
 * @returns {Promise<Object>} - The result from the Python bridge
 */
async function executePythonBridge(params) {
    return new Promise((resolve, reject) => {
        // Spawn the Python process
        const pythonProcess = spawn('python', [PYTHON_BRIDGE_PATH]);
        
        let stdoutData = '';
        let stderrData = '';
        
        // Collect stdout data
        pythonProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });
        
        // Collect stderr data
        pythonProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });
        
        // Handle process completion
        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python process exited with code ${code}\n${stderrData}`));
                return;
            }
            
            try {
                const result = JSON.parse(stdoutData);
                resolve(result);
            } catch (error) {
                reject(new Error(`Failed to parse Python output: ${error.message}\nOutput: ${stdoutData}`));
            }
        });
        
        // Handle process errors
        pythonProcess.on('error', (error) => {
            reject(new Error(`Failed to start Python process: ${error.message}`));
        });
        
        // Send the parameters to the Python process
        pythonProcess.stdin.write(JSON.stringify(params));
        pythonProcess.stdin.end();
    });
}

/**
 * Upload a file to Telegram using the Python implementation
 * @param {string} filePath - Path to the file to upload
 * @param {string} caption - Caption for the file
 * @returns {Promise<Object>} - The upload result
 */
async function uploadToTelegram(filePath, caption = '') {
    try {
        // Determine if this is a large file (> 100MB)
        const fs = await import('fs');
        const stats = fs.statSync(filePath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        const isLarge = fileSizeInMB > 100;
        
        // Prepare the parameters for the Python bridge
        const params = {
            command: 'upload',
            file_path: filePath,
            caption: caption,
            is_large: isLarge
        };
        
        // Execute the Python bridge
        return await executePythonBridge(params);
    } catch (error) {
        console.error('Error in uploadToTelegram:', error);
        throw error;
    }
}

/**
 * Upload a large file to Telegram using the Python implementation
 * @param {string} filePath - Path to the file to upload
 * @param {string} caption - Caption for the file
 * @returns {Promise<Object>} - The upload result
 */
async function uploadLargeFile(filePath, caption = '') {
    try {
        // Prepare the parameters for the Python bridge
        const params = {
            command: 'upload',
            file_path: filePath,
            caption: caption,
            is_large: true
        };
        
        // Execute the Python bridge
        return await executePythonBridge(params);
    } catch (error) {
        console.error('Error in uploadLargeFile:', error);
        throw error;
    }
}

/**
 * Disconnect the Telegram client
 * @returns {Promise<Object>} - The result of the disconnect operation
 */
async function cleanupResources() {
    try {
        // Prepare the parameters for the Python bridge
        const params = {
            command: 'disconnect'
        };
        
        // Execute the Python bridge
        return await executePythonBridge(params);
    } catch (error) {
        console.error('Error in cleanupResources:', error);
        throw error;
    }
}

// Export the functions
export { uploadToTelegram, uploadLargeFile, cleanupResources };