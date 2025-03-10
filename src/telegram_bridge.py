#!/usr/bin/env python
import os
import sys
import json
import asyncio
from pathlib import Path

# Import the telegram module functions
from telegram import upload_file, upload_large, disconnect


def parse_input():
    """Parse the JSON input from stdin"""
    try:
        input_data = sys.stdin.read()
        return json.loads(input_data)
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON input: {str(e)}"}


def send_output(data):
    """Send JSON output to stdout"""
    print(json.dumps(data))
    sys.stdout.flush()


def handle_upload(params):
    """Handle the upload request"""
    try:
        file_path = params.get("file_path")
        caption = params.get("caption", "")
        is_large = params.get("is_large", False)
        
        if not file_path:
            return {"success": False, "error": "Missing file_path parameter"}
        
        # Choose the appropriate upload function based on the is_large flag
        if is_large:
            result = upload_large(file_path, caption)
        else:
            result = upload_file(file_path, caption)
            
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


def handle_disconnect(params):
    """Handle the disconnect request"""
    try:
        disconnect()
        return {"success": True, "message": "Telegram client disconnected"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    """Main entry point for the bridge"""
    try:
        # Parse the input from stdin
        params = parse_input()
        
        # Get the command
        command = params.get("command")
        
        # Handle the command
        if command == "upload":
            result = handle_upload(params)
        elif command == "disconnect":
            result = handle_disconnect(params)
        else:
            result = {"success": False, "error": f"Unknown command: {command}"}
        
        # Send the result back
        send_output(result)
    except Exception as e:
        send_output({"success": False, "error": str(e)})


if __name__ == "__main__":
    main()