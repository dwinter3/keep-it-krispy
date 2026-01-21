"""
Document Processor Lambda

Extracts text from PDFs stored in S3 using AWS Textract.
Invoked asynchronously after file upload.
"""

import json
import os
import time
import boto3

# AWS clients
s3 = boto3.client('s3')
textract = boto3.client('textract')
dynamodb = boto3.resource('dynamodb')

BUCKET_NAME = os.environ.get('BUCKET_NAME', 'krisp-transcripts-754639201213')
TABLE_NAME = os.environ.get('TABLE_NAME', 'krisp-transcripts-index')


def extract_text_with_textract(bucket: str, key: str) -> tuple[str, int]:
    """
    Extract text from a document using AWS Textract.
    Uses async API for large files, sync for small.
    """
    # Start async text detection job
    print(f"Starting Textract job for s3://{bucket}/{key}")

    response = textract.start_document_text_detection(
        DocumentLocation={
            'S3Object': {
                'Bucket': bucket,
                'Name': key
            }
        }
    )

    job_id = response['JobId']
    print(f"Textract job started: {job_id}")

    # Poll for completion (Lambda has 15 min timeout)
    while True:
        response = textract.get_document_text_detection(JobId=job_id)
        status = response['JobStatus']

        if status == 'SUCCEEDED':
            break
        elif status == 'FAILED':
            raise Exception(f"Textract job failed: {response.get('StatusMessage', 'Unknown error')}")

        print(f"Job status: {status}, waiting...")
        time.sleep(5)

    # Extract text from all pages
    text_parts = []
    next_token = None

    while True:
        if next_token:
            response = textract.get_document_text_detection(
                JobId=job_id,
                NextToken=next_token
            )
        else:
            response = textract.get_document_text_detection(JobId=job_id)

        for block in response.get('Blocks', []):
            if block['BlockType'] == 'LINE':
                text_parts.append(block['Text'])

        next_token = response.get('NextToken')
        if not next_token:
            break

    content = '\n'.join(text_parts)
    word_count = len(content.split())

    return content, word_count


def handler(event, context):
    """
    Process a document uploaded to S3.

    Event format:
    {
        "document_id": "uuid",
        "user_id": "user_id",
        "s3_key": "users/user_id/documents/uuid/filename.txt",
        "raw_file_key": "users/user_id/documents/uuid/original.pdf",
        "format": "pdf"
    }
    """
    print(f"Document processor invoked with event: {json.dumps(event)}")

    document_id = event.get('document_id')
    user_id = event.get('user_id')
    raw_file_key = event.get('raw_file_key')
    s3_key = event.get('s3_key')
    doc_format = event.get('format', 'pdf')

    if not all([document_id, user_id, raw_file_key]):
        print("Missing required fields")
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Missing required fields'})
        }

    table = dynamodb.Table(TABLE_NAME)

    try:
        # Extract text using Textract
        if doc_format == 'pdf':
            content, word_count = extract_text_with_textract(BUCKET_NAME, raw_file_key)
            print(f"Extracted {word_count} words from PDF using Textract")
        else:
            print(f"Unsupported format: {doc_format}")
            return {
                'statusCode': 400,
                'body': json.dumps({'error': f'Unsupported format: {doc_format}'})
            }

        # Get title from first line
        lines = content.split('\n')
        title = next((line.strip()[:200] for line in lines if line.strip()), None)

        # Store extracted text in S3
        print(f"Storing extracted text to s3://{BUCKET_NAME}/{s3_key}")
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=content.encode('utf-8'),
            ContentType='text/plain; charset=utf-8'
        )

        # Update DynamoDB record
        print(f"Updating DynamoDB record for document {document_id}")
        update_expression = "SET word_count = :wc, processing = :p, processing_error = :pe"
        expression_values = {
            ':wc': word_count,
            ':p': False,
            ':pe': None
        }

        # Only update title if we extracted one and it looks meaningful
        if title and len(title) > 3:
            update_expression += ", title = :t"
            expression_values[':t'] = title

        table.update_item(
            Key={'meeting_id': f'doc_{document_id}'},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values
        )

        print(f"Successfully processed document {document_id}")

        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'document_id': document_id,
                'word_count': word_count,
                'title': title
            })
        }

    except Exception as e:
        print(f"Error processing document: {str(e)}")

        # Update DynamoDB with error status
        try:
            table.update_item(
                Key={'meeting_id': f'doc_{document_id}'},
                UpdateExpression="SET processing = :p, processing_error = :pe",
                ExpressionAttributeValues={
                    ':p': False,
                    ':pe': str(e)
                }
            )
        except Exception as update_error:
            print(f"Failed to update error status: {str(update_error)}")

        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'document_id': document_id
            })
        }
