import os
import sys
import time
import signal
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, Callable

import dotenv
from telethon import TelegramClient
from telethon.tl.types import DocumentAttributeFilename
from telethon.sessions import StringSession

# Load environment variables
dotenv.load_dotenv()

API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
STRING_SESSION = os.getenv('TELEGRAM_STRING_SESSION')
CHANNEL_ID = os.getenv('TELEGRAM_CHANNEL_ID')
client = None


class TelegramUploadError(Exception):
    """Custom exception for Telegram upload errors"""
    def __init__(self, message, details=None):
        super().__init__(message)
        self.name = 'TelegramUploadError'
        self.details = details or {}


async def retry(func, max_retries=5, initial_delay=0.5):
    """Retry a function with exponential backoff"""
    retries = 0
    while retries < max_retries:
        try:
            return await func()
        except Exception as error:
            if retries == max_retries - 1:
                raise error
            delay = initial_delay * (2 ** retries)
            print(f"Retry {retries + 1}/{max_retries} after {delay}s")
            await asyncio.sleep(delay)
            retries += 1


async def optimize_connection(client):
    """Optimize connection by connecting to nearest DC"""
    try:
        nearest_dc = await client.get_me()
        return True
    except Exception as error:
        print(f"Connection optimization failed: {error}")
        return False


def optimize_memory():
    """Optimize memory usage with aggressive garbage collection"""
    import gc
    import sys
    
    # Force a complete garbage collection
    gc.collect(2)  # Full collection with all generations
    
    # Print memory usage information in debug mode
    if os.getenv('TELEGRAM_DEBUG') == '1':
        import psutil
        process = psutil.Process(os.getpid())
        memory_info = process.memory_info()
        print(f"Memory usage: {memory_info.rss / 1024 / 1024:.2f} MB")
        
    # Suggest Python to release memory to OS if possible
    if hasattr(sys, 'malloc_trim'):
        sys.malloc_trim(0)
    elif sys.platform == 'win32':
        import ctypes
        ctypes.windll.kernel32.SetProcessWorkingSetSize(-1, -1)


async def initialize_client():
    """Initialize and connect the Telegram client with optimized parameters"""
    global client
    
    if not client:
        if not all([API_ID, API_HASH, STRING_SESSION, CHANNEL_ID]):
            raise ValueError("Missing required Telegram credentials")
        
        # Enhanced client configuration with optimized parameters
        client = TelegramClient(
            StringSession(STRING_SESSION),
            int(API_ID),
            API_HASH,
            connection_retries=5,
            retry_delay=0.25,
            timeout=30,
            flood_sleep_threshold=60,
            auto_reconnect=True,
            sequential_updates=False,  # Allow parallel processing
            request_retries=3,
            connection=None,  # Let Telethon choose the best connection type
            use_ipv6=False,
            proxy=None,  # Add proxy support if needed
            timeout=60,  # Increased timeout for large operations
            receive_updates=False  # Disable updates to save resources during upload
        )
        
        try:
            await client.connect()
            me = await client.get_me()
            print(f"Connected to Telegram as: {me.username}")
            
            # Check if we're connected to the nearest DC
            current_dc = await client.get_me()
            print(f"Connected to DC: {client.session.dc_id}")
            
        except Exception as e:
            print(f"Connection error: {str(e)}")
            # Try to reconnect with different parameters if initial connection fails
            if client:
                await client.disconnect()
                client = None
            raise
    
    return client


async def validate_file(file_path):
    """Validate file existence, size and readability"""
    path = Path(file_path)
    
    if not path.exists():
        raise TelegramUploadError(f"File not found: {file_path}")
    
    # Check if it's a regular file (not a directory or special file)
    if not path.is_file():
        raise TelegramUploadError(f"Not a regular file: {file_path}")
    
    # Check file size
    try:
        file_size = path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
    except OSError as e:
        raise TelegramUploadError(f"Cannot get file size: {str(e)}", {"file_path": file_path})
    
    # Check if file is empty
    if file_size == 0:
        raise TelegramUploadError(f"File is empty: {file_path}")
    
    # Check if file exceeds Telegram's size limit
    if file_size_mb > 2048:
        raise TelegramUploadError(
            "File size exceeds Telegram's limit",
            {"size": file_size_mb, "limit": 2048, "file": path.name}
        )
    
    # Check if file is readable
    if not os.access(file_path, os.R_OK):
        raise TelegramUploadError(f"File is not readable: {file_path}")
    
    # Check if file is not locked by another process
    try:
        with open(file_path, 'rb') as f:
            # Try to read a small chunk to verify file is accessible
            f.read(1)
    except IOError as e:
        raise TelegramUploadError(f"File is locked or inaccessible: {str(e)}", {"file_path": file_path})
    
    # Return file information
    return {
        "file_size": file_size,
        "file_size_mb": file_size_mb,
        "file_name": path.name,
        "file_extension": path.suffix.lower(),
        "last_modified": path.stat().st_mtime
    }


class UploadProgress:
    """Track and display upload progress"""
    def __init__(self, file_size):
        self.file_size = file_size
        self.start_time = time.time()
        self.last_update = 0
        self.last_progress = 0
        self.speed_history = []
        self.last_speed_update = time.time()
    
    def update(self, uploaded_bytes, total_bytes):
        now = time.time()
        progress = uploaded_bytes / total_bytes if total_bytes else 0
        current_progress = int(progress * 100)
        
        # Update speed history every second
        if now - self.last_speed_update >= 1:
            elapsed = now - self.start_time
            speed = uploaded_bytes / elapsed / (1024 * 1024) if elapsed > 0 else 0
            self.speed_history.append(speed)
            if len(self.speed_history) > 5:
                self.speed_history.pop(0)
            self.last_speed_update = now
        
        # Calculate average speed
        avg_speed = sum(self.speed_history) / len(self.speed_history) if self.speed_history else 0
        
        # Update progress display
        if now - self.last_update >= 1 and current_progress > self.last_progress:
            remaining_bytes = total_bytes - uploaded_bytes
            eta = int(remaining_bytes / (avg_speed * 1024 * 1024)) if avg_speed > 0 else 0
            
            print(f"⬆️ Progress: {current_progress}% | Speed: {avg_speed:.2f} MB/s | ETA: {eta}s")
            
            self.last_update = now
            self.last_progress = current_progress


async def upload_to_telegram(file_path, caption=''):
    """Upload a file to Telegram with progress tracking and retries"""
    retries = 0
    max_retries = 5
    
    # Optimize memory before starting upload
    optimize_memory()
    
    while retries < max_retries:
        try:
            client = await initialize_client()
            
            # Try to optimize connection to nearest DC
            await optimize_connection(client)
            
            file_info = await validate_file(file_path)
            file_size = file_info["file_size"]
            file_size_mb = file_info["file_size_mb"]
            
            print(f"📤 Uploading {Path(file_path).name} ({file_size_mb:.2f}MB)")
            
            progress = UploadProgress(file_size)
            
            # Define progress callback
            def progress_callback(current, total):
                progress.update(current, total)
                # Periodically optimize memory during large uploads
                if current > 0 and current % (50 * 1024 * 1024) < 1024 * 1024:  # Every ~50MB
                    optimize_memory()
            
            # Determine optimal part size based on file size
            part_size_kb = 512  # Default 512KB chunks
            if file_size_mb > 500:  # For files > 500MB
                part_size_kb = 2048  # Use 2MB chunks
            elif file_size_mb > 100:  # For files > 100MB
                part_size_kb = 1024  # Use 1MB chunks
            
            # Send the file with optimized parameters
            result = await client.send_file(
                CHANNEL_ID,
                file=file_path,
                caption=caption,
                progress_callback=progress_callback,
                force_document=True,
                part_size_kb=part_size_kb,
                attributes=[DocumentAttributeFilename(Path(file_path).name)]
            )
            
            # Generate message link
            channel_id = CHANNEL_ID.replace('-100', '')
            message_link = f"https://t.me/c/{channel_id}/{result.id}"
            print(f"✅ Upload complete: {message_link}")
            
            # Final memory cleanup
            optimize_memory()
            
            return {
                "success": True,
                "message_id": result.id,
                "message_link": message_link,
                "file_size": file_size_mb,
                "file_name": Path(file_path).name
            }
            
        except Exception as error:
            error_str = str(error)
            print(f"Upload attempt {retries + 1} failed: {error_str}")
            
            # Handle rate limiting
            if "FLOOD_WAIT_" in error_str:
                import re
                match = re.search(r'FLOOD_WAIT_(\d+)', error_str)
                if match:
                    seconds = int(match.group(1))
                    print(f"⏳ Rate limit hit. Waiting {seconds}s...")
                    await asyncio.sleep(seconds)
                    continue
            
            # Handle connection errors specifically
            if any(conn_err in error_str for conn_err in ["ConnectionError", "TimeoutError", "ServerError"]):
                print("Connection issue detected, waiting longer before retry...")
                await asyncio.sleep(5)  # Wait longer for connection issues
                retries += 1
                continue
            
            retries += 1
            if retries < max_retries:
                delay = (2 ** retries) * 0.25
                print(f"Retry {retries}/{max_retries} after {delay}s")
                await asyncio.sleep(delay)
            else:
                raise TelegramUploadError(f"Upload failed after {max_retries} attempts", {"original_error": error_str})


async def upload_large_file(file_path, caption=''):
    """Upload a large file to Telegram with streaming and optimized settings"""
    try:
        # Aggressive memory optimization before large file upload
        optimize_memory()
        
        # Initialize client with retry mechanism
        client = await retry(initialize_client)
        
        # Optimize connection to nearest DC
        await optimize_connection(client)
        
        # Validate file with detailed checks
        file_info = await validate_file(file_path)
        file_size = file_info["file_size"]
        file_size_mb = file_info["file_size_mb"]
        
        # Initialize progress tracking
        progress = UploadProgress(file_size)
        
        print(f"📤 Uploading large file: {Path(file_path).name} ({file_size_mb:.2f}MB)")
        
        # Enhanced progress callback with memory optimization
        def progress_callback(current, total):
            progress.update(current, total)
            # More frequent memory optimization for large files
            if current > 0 and current % (25 * 1024 * 1024) < 1024 * 1024:  # Every ~25MB
                optimize_memory()
        
        # Determine optimal part size based on file size
        # Larger files need larger chunks for better performance
        part_size_kb = 2048  # Default 2MB for large files
        if file_size_mb > 1000:  # For files > 1GB
            part_size_kb = 4096  # Use 4MB chunks
        
        # Use retry for the actual upload with optimized parameters
        async def upload_func():
            return await client.send_file(
                CHANNEL_ID,
                file=file_path,
                caption=caption,
                progress_callback=progress_callback,
                force_document=True,
                part_size_kb=part_size_kb,
                attributes=[
                    DocumentAttributeFilename(Path(file_path).name)
                ],
                workers=8  # Use multiple workers for parallel upload
            )
        
        # Execute upload with retry mechanism
        result = await retry(upload_func, max_retries=7, initial_delay=1.0)  # More retries for large files
        
        # Generate message link
        channel_id = CHANNEL_ID.replace('-100', '')
        message_link = f"https://t.me/c/{channel_id}/{result.id}"
        print(f"✅ Large file upload complete: {message_link}")
        
        # Final memory cleanup
        optimize_memory()
        
        return {
            "success": True,
            "message_id": result.id,
            "message_link": message_link,
            "file_size": file_size_mb,
            "file_name": Path(file_path).name
        }
        
    except Exception as error:
        error_str = str(error)
        # Log detailed error information
        print(f"❌ Large file upload failed: {error_str}")
        
        # Clean up memory after failure
        optimize_memory()
        
        raise TelegramUploadError("Large file upload failed", {
            "original_error": error_str,
            "file_path": file_path,
            "file_size_mb": file_info["file_size_mb"] if "file_info" in locals() else "unknown"
        })


async def cleanup_resources():
    """Disconnect the client and clean up resources"""
    global client
    if client:
        try:
            await client.disconnect()
            client = None
            print("🔌 Telegram client disconnected")
        except Exception as error:
            print(f"❌ Error during cleanup: {error}")


# Register signal handlers
def signal_handler(sig, frame):
    print(f"Received signal {sig}. Cleaning up...")
    asyncio.run(cleanup_resources())
    sys.exit(0)


# Register signal handlers
for sig in [signal.SIGINT, signal.SIGTERM]:
    signal.signal(sig, signal_handler)


# Main functions to be called from other modules
def upload_file(file_path, caption=''):
    """Synchronous wrapper for upload_to_telegram"""
    try:
        result = asyncio.run(upload_to_telegram(file_path, caption))
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


def upload_large(file_path, caption=''):
    """Synchronous wrapper for upload_large_file"""
    try:
        result = asyncio.run(upload_large_file(file_path, caption))
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


def disconnect():
    """Synchronous wrapper for cleanup_resources"""
    try:
        asyncio.run(cleanup_resources())
        return {"success": True, "message": "Disconnected successfully"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# Example usage
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python telegram.py <file_path> [caption]")
        sys.exit(1)
    
    file_path = sys.argv[1]
    caption = sys.argv[2] if len(sys.argv) > 2 else ''
    
    try:
        if Path(file_path).stat().st_size > 100 * 1024 * 1024:  # 100MB
            result = upload_large(file_path, caption)
        else:
            result = upload_file(file_path, caption)
        print(f"Upload successful: {result['message_link']}")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)