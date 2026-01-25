# Vector Backend Cost Forecast: S3 Vectors vs RuVector

## Scenario Parameters

| Parameter | Value |
|-----------|-------|
| Transcripts per day | 4-5 (avg 4.5) |
| Call duration | 30min - 1hr |
| Forecast period | 2 years (730 days) |
| Current vectors | 158 |
| Current transcripts | 50 |

## Volume Projections

### Transcript & Vector Growth

| Metric | Year 1 | Year 2 | Total |
|--------|--------|--------|-------|
| New transcripts | 1,643 | 1,643 | 3,285 |
| Vectors per transcript (avg) | 8 | 8 | 8 |
| New vectors | 13,140 | 13,140 | 26,280 |
| Cumulative vectors | 13,298 | 26,438 | 26,438 |

*Note: Assumes 500-word chunks. 30min call ≈ 4,000 words (8 chunks), 1hr call ≈ 8,000 words (16 chunks). Average: 8 vectors/transcript.*

### Query Volume Estimates

| Use Case | Daily Queries | Monthly Queries | Yearly Queries |
|----------|---------------|-----------------|----------------|
| User searches | 10-20 | 450 | 5,400 |
| AI context retrieval | 5-10 | 225 | 2,700 |
| Morning briefings | 1 | 30 | 365 |
| **Total** | **16-31** | **~700** | **8,400** |

---

## S3 Vectors Cost Breakdown

### 1. Storage Costs

| Component | Size | Monthly Cost |
|-----------|------|--------------|
| Vector data (1024 dims × 4 bytes) | 4 KB/vector | - |
| Metadata per vector | ~1 KB | - |
| **Year 1 end** (13,298 vectors) | ~66 MB | $0.002 |
| **Year 2 end** (26,438 vectors) | ~132 MB | $0.003 |

*S3 Standard: $0.023/GB/month - Storage cost is negligible*

### 2. S3 Vectors API Costs

| Operation | Price | Year 1 Volume | Year 1 Cost | Year 2 Volume | Year 2 Cost |
|-----------|-------|---------------|-------------|---------------|-------------|
| PutVector | $0.0005/req | 13,140 | $6.57 | 13,140 | $6.57 |
| QueryVectors | $0.0004/req | 8,400 | $3.36 | 8,400 | $3.36 |
| ListVectors | $0.0004/req | ~100 | $0.04 | ~100 | $0.04 |
| **Subtotal** | | | **$9.97** | | **$9.97** |

### 3. Amazon Bedrock Embedding Costs

| Model | Price | Details |
|-------|-------|---------|
| Titan Text Embeddings v2 | $0.00002/1K tokens | 1024 dimensions |

| Metric | Calculation | Cost |
|--------|-------------|------|
| Tokens per chunk | ~700 tokens (500 words) | - |
| Cost per embedding | 700/1000 × $0.00002 | $0.000014 |
| Embeddings per year | 13,140 (vectors) + 8,400 (queries) | 21,540 |
| **Year 1 embedding cost** | 21,540 × $0.000014 | **$0.30** |
| **Year 2 embedding cost** | 21,540 × $0.000014 | **$0.30** |

### S3 Vectors Total Cost

| Period | Storage | API | Embeddings | **Total** |
|--------|---------|-----|------------|-----------|
| Year 1 | $0.02 | $9.97 | $0.30 | **$10.29** |
| Year 2 | $0.04 | $9.97 | $0.30 | **$10.31** |
| **2-Year Total** | $0.06 | $19.94 | $0.60 | **$20.60** |

---

## RuVector Cost Breakdown (ECS Fargate)

### Infrastructure Components

| Component | Configuration | Monthly Cost |
|-----------|---------------|--------------|
| ECS Fargate Task | 0.5 vCPU, 1 GB RAM | $14.57 |
| Application Load Balancer | Internal, minimal traffic | $16.43 |
| EFS Storage | 1 GB (growing to 500 MB) | $0.30 |
| NAT Gateway (if in private subnet) | Data transfer | ~$3.50 |
| **Monthly Total** | | **$34.80** |

### Detailed Fargate Calculation

```
vCPU: 0.5 × $0.04048/hr × 730 hrs/month = $14.78
Memory: 1 GB × $0.004445/hr × 730 hrs/month = $3.24
Total Fargate: ~$18/month

ALB: $0.0225/hr × 730 = $16.43
ALB LCU: ~$0.008/LCU-hr (minimal at low traffic) = ~$1/month
```

### RuVector Total Cost

| Period | Compute | ALB | Storage | **Total** |
|--------|---------|-----|---------|-----------|
| Year 1 | $216 | $209 | $3.60 | **$428.60** |
| Year 2 | $216 | $209 | $3.60 | **$428.60** |
| **2-Year Total** | $432 | $418 | $7.20 | **$857.20** |

---

## Alternative: RuVector on EC2 (t4g.micro)

For cost-sensitive deployments:

| Component | Configuration | Monthly Cost |
|-----------|---------------|--------------|
| EC2 t4g.micro | 2 vCPU, 1 GB RAM | $6.05 |
| EBS Storage | 8 GB gp3 | $0.64 |
| **Monthly Total** | | **$6.69** |
| **2-Year Total** | | **$160.56** |

*Note: Less resilient than Fargate, requires manual management*

---

## Cost Comparison Summary

| Backend | Year 1 | Year 2 | 2-Year Total | Monthly Avg |
|---------|--------|--------|--------------|-------------|
| **S3 Vectors** | $10.29 | $10.31 | **$20.60** | **$0.86** |
| **RuVector (Fargate)** | $428.60 | $428.60 | **$857.20** | **$35.72** |
| **RuVector (EC2)** | $80.28 | $80.28 | **$160.56** | **$6.69** |

### Cost per 1,000 Queries

| Backend | Cost/1K Queries |
|---------|-----------------|
| S3 Vectors | $1.23 |
| RuVector (Fargate) | $51.10 |
| RuVector (EC2) | $9.57 |

---

## Performance vs Cost Analysis

### Latency Comparison (from testing)

| Metric | S3 Vectors | RuVector | Improvement |
|--------|------------|----------|-------------|
| Average latency | 125.5 ms | 3.4 ms | **37x faster** |
| P95 latency | ~150 ms | ~10 ms | **15x faster** |

### Quality Metrics

| Metric | RuVector vs S3 Vectors | Target |
|--------|------------------------|--------|
| Recall@10 | 97.5% | >90% ✅ |
| Rank Correlation | 0.961 | >0.80 ✅ |

### When RuVector Makes Sense

**Choose RuVector if:**
- Real-time search is critical (<10ms latency required)
- High query volume (>10,000 queries/month)
- User experience depends on instant results
- Budget allows ~$35/month (Fargate) or ~$7/month (EC2)

**Choose S3 Vectors if:**
- Cost is primary concern (<$1/month)
- 100-150ms latency is acceptable
- Low-to-moderate query volume
- Serverless/zero-maintenance is preferred
- Data stays 100% in AWS managed services

---

## Break-Even Analysis

At what query volume does RuVector become cost-effective?

### S3 Vectors Cost Formula
```
Monthly Cost = (Vectors × $0.0005) + (Queries × $0.0004) + (Embeddings × $0.000014)
```

### RuVector Cost Formula (Fargate)
```
Monthly Cost = $34.80 (fixed)
```

### Break-Even Point
```
$34.80 = (V × $0.0005) + (Q × $0.0004) + ((V + Q) × $0.000014)

For 1,095 new vectors/month (from 4.5 transcripts × 8 vectors × 30 days):
$34.80 = $0.55 + (Q × $0.0004) + ((1,095 + Q) × $0.000014)
$34.80 = $0.55 + $0.015 + (Q × 0.000414)
Q = $34.24 / $0.000414
Q = 82,705 queries/month
```

**Break-even: ~82,700 queries/month** (2,760 queries/day)

At current estimated 700 queries/month, S3 Vectors is **118x more cost-effective**.

---

## Recommendation

### For Your Use Case (4-5 transcripts/day, ~700 queries/month)

**Recommended: S3 Vectors**

| Factor | Assessment |
|--------|------------|
| Cost | $0.86/month vs $35.72/month (41x cheaper) |
| Latency | 125ms acceptable for async searches |
| Maintenance | Zero - fully managed |
| Quality | Baseline (100% recall by definition) |
| Scalability | Handles millions of vectors |

### Migration Path

Keep the dual-write architecture ready for future:

1. **Now**: Use S3 Vectors as primary (`MEMORY_PROVIDER=s3-vectors`)
2. **If latency becomes issue**: Enable A/B testing (`MEMORY_PROVIDER=ab-router`)
3. **If high query volume**: Switch to RuVector (`MEMORY_PROVIDER=ruvector`)

The abstraction layer you built enables switching with a single environment variable change.

---

## Appendix: Pricing Sources

- [S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [S3 Vectors Pricing](https://aws.amazon.com/s3/vectors/pricing/)
- [Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)
- [Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [EC2 Pricing](https://aws.amazon.com/ec2/pricing/)

*Prices as of January 2025, us-east-1 region*
