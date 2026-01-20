"""
Test script for krispy-live format transformations.

Run with: python test_krispy_live.py
"""

import json
import sys
sys.path.insert(0, '.')

from handler import (
    detect_krispy_live_format,
    transform_krispy_live_payload,
    convert_assemblyai_to_krisp,
    convert_whisper_to_krisp,
    convert_gemini_to_krisp,
    convert_krispy_webhook_to_krisp,
)


def test_detect_assemblyai_format():
    """Test detection of AssemblyAI format."""
    payload = {
        "id": "abc123",
        "text": "Hello world",
        "utterances": [
            {"speaker": "A", "start": 0, "end": 5000, "text": "Hello"},
            {"speaker": "B", "start": 5000, "end": 10000, "text": "World"}
        ],
        "audio_duration": 10000
    }
    result = detect_krispy_live_format(payload)
    assert result == "assemblyai", f"Expected 'assemblyai', got '{result}'"
    print("✓ detect_assemblyai_format passed")


def test_detect_whisper_format():
    """Test detection of Whisper format."""
    payload = {
        "text": "Hello world",
        "segments": [
            {"start": 0.0, "end": 5.0, "text": "Hello"},
            {"start": 5.0, "end": 10.0, "text": "World"}
        ],
        "language": "en"
    }
    result = detect_krispy_live_format(payload)
    assert result == "whisper", f"Expected 'whisper', got '{result}'"
    print("✓ detect_whisper_format passed")


def test_detect_gemini_format():
    """Test detection of Gemini Live format."""
    payload = {
        "created_at": 1705753200.0,
        "turns": [
            {"role": "user", "text": "Hello", "ts": 1705753200.0},
            {"role": "assistant", "text": "Hi there!", "ts": 1705753205.0}
        ]
    }
    result = detect_krispy_live_format(payload)
    assert result == "gemini", f"Expected 'gemini', got '{result}'"
    print("✓ detect_gemini_format passed")


def test_detect_webhook_format():
    """Test detection of krispy-live webhook format."""
    payload = {
        "audio_path": "/recordings/meeting_20250120_143022.wav",
        "assembly_transcript_path": "/recordings/meeting_20250120_143022_assemblyai.json",
        "assembly_text": "This is the full transcript text.",
        "timestamp": "2025-01-20T14:30:22.123456"
    }
    result = detect_krispy_live_format(payload)
    assert result == "webhook", f"Expected 'webhook', got '{result}'"
    print("✓ detect_webhook_format passed")


def test_detect_standard_krisp_format():
    """Test that standard Krisp format returns None (no transformation needed)."""
    payload = {
        "event": "transcript_created",
        "meeting_id": "meeting123",
        "title": "Team Standup",
        "data": {
            "raw_content": "Speaker 1 | 00:00\nHello everyone",
            "meeting": {
                "id": "meeting123",
                "title": "Team Standup",
                "duration": 1800
            }
        }
    }
    result = detect_krispy_live_format(payload)
    assert result is None, f"Expected None, got '{result}'"
    print("✓ detect_standard_krisp_format passed")


def test_convert_assemblyai():
    """Test AssemblyAI to Krisp conversion."""
    payload = {
        "id": "abc123",
        "text": "Hello world. How are you?",
        "utterances": [
            {"speaker": "A", "start": 0, "end": 3000, "text": "Hello world."},
            {"speaker": "B", "start": 3500, "end": 6000, "text": "How are you?"}
        ],
        "audio_duration": 6000,
        "confidence": 0.95
    }

    result = convert_assemblyai_to_krisp(payload)

    assert result['event'] == 'transcript_created'
    assert 'assemblyai_abc123' in result['meeting_id']
    assert 'Speaker A | 00:00' in result['data']['raw_content']
    assert 'Speaker B | 00:03' in result['data']['raw_content']
    assert 'Hello world.' in result['data']['raw_content']
    assert 'How are you?' in result['data']['raw_content']
    assert result['data']['meeting']['duration'] == 6
    assert result['_krispy_live']['source'] == 'assemblyai'
    print("✓ convert_assemblyai passed")
    print(f"  Raw content:\n{result['data']['raw_content'][:200]}...")


def test_convert_whisper():
    """Test Whisper to Krisp conversion."""
    payload = {
        "text": "Hello world. How are you?",
        "segments": [
            {"start": 0.0, "end": 3.0, "text": "Hello world."},
            {"start": 3.5, "end": 6.0, "text": "How are you?"}
        ],
        "language": "en"
    }

    result = convert_whisper_to_krisp(payload)

    assert result['event'] == 'transcript_created'
    assert 'whisper_' in result['meeting_id']
    assert 'Speaker 1 | 00:00' in result['data']['raw_content']
    assert 'Speaker 1 | 00:03' in result['data']['raw_content']
    assert result['data']['meeting']['duration'] == 6
    assert result['_krispy_live']['source'] == 'whisper'
    assert result['_krispy_live']['language'] == 'en'
    print("✓ convert_whisper passed")
    print(f"  Raw content:\n{result['data']['raw_content'][:200]}...")


def test_convert_gemini():
    """Test Gemini Live to Krisp conversion."""
    payload = {
        "created_at": 1705753200.0,
        "turns": [
            {"role": "user", "text": "What's the weather like?", "ts": 1705753200.0},
            {"role": "assistant", "text": "I don't have access to weather data.", "ts": 1705753205.0},
            {"role": "user", "text": "That's okay.", "ts": 1705753210.0}
        ]
    }

    result = convert_gemini_to_krisp(payload)

    assert result['event'] == 'transcript_created'
    assert 'gemini_' in result['meeting_id']
    assert 'You | 00:00' in result['data']['raw_content']
    assert 'Gemini Assistant | 00:05' in result['data']['raw_content']
    assert "What's the weather like?" in result['data']['raw_content']
    assert result['data']['meeting']['duration'] == 10
    assert result['_krispy_live']['source'] == 'gemini_live'
    print("✓ convert_gemini passed")
    print(f"  Raw content:\n{result['data']['raw_content'][:300]}...")


def test_convert_webhook():
    """Test krispy-live webhook to Krisp conversion."""
    payload = {
        "audio_path": "/recordings/meeting_20250120_143022.wav",
        "assembly_text": "This is the full meeting transcript with important discussions.",
        "timestamp": "2025-01-20T14:30:22.123456"
    }

    result = convert_krispy_webhook_to_krisp(payload)

    assert result['event'] == 'transcript_created'
    assert result['meeting_id'] == 'meeting_20250120_143022'
    assert 'Speaker 1 | 00:00' in result['data']['raw_content']
    assert 'full meeting transcript' in result['data']['raw_content']
    assert result['_krispy_live']['source'] == 'assemblyai'
    print("✓ convert_webhook passed")
    print(f"  Raw content:\n{result['data']['raw_content'][:200]}...")


def test_transform_pipeline():
    """Test full transformation pipeline."""
    # AssemblyAI payload
    assemblyai_payload = {
        "id": "test123",
        "utterances": [
            {"speaker": "A", "start": 0, "end": 5000, "text": "Meeting starts"}
        ],
        "audio_duration": 5000
    }

    result = transform_krispy_live_payload(assemblyai_payload)
    assert result['event'] == 'transcript_created'
    assert 'raw_content' in result.get('data', {})
    print("✓ transform_pipeline passed")


def test_passthrough_standard_format():
    """Test that standard Krisp format passes through unchanged."""
    original = {
        "event": "notes_generated",
        "meeting_id": "original_123",
        "title": "Original Meeting",
        "data": {"notes": "Some notes"}
    }

    result = transform_krispy_live_payload(original)

    assert result == original, "Standard format should pass through unchanged"
    print("✓ passthrough_standard_format passed")


def run_all_tests():
    """Run all tests."""
    print("\n=== Testing Krispy-Live Format Detection ===\n")
    test_detect_assemblyai_format()
    test_detect_whisper_format()
    test_detect_gemini_format()
    test_detect_webhook_format()
    test_detect_standard_krisp_format()

    print("\n=== Testing Format Conversions ===\n")
    test_convert_assemblyai()
    test_convert_whisper()
    test_convert_gemini()
    test_convert_webhook()

    print("\n=== Testing Pipeline ===\n")
    test_transform_pipeline()
    test_passthrough_standard_format()

    print("\n" + "="*50)
    print("All tests passed!")
    print("="*50 + "\n")


if __name__ == "__main__":
    run_all_tests()
