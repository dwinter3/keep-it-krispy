/**
 * A/B Testing Router for Memory Providers
 *
 * Routes a percentage of traffic to the experimental provider (RuVector).
 * Supports shadow mode for comparing results without affecting users.
 * Collects metrics for latency and recall comparison.
 *
 * Usage:
 *   Set MEMORY_PROVIDER=ab-router
 *   Set AB_RUVECTOR_PERCENTAGE=10 (routes 10% to RuVector)
 *   Set AB_ENABLE_SHADOW=true (query both, compare results)
 *   Set AB_ENABLE_METRICS=true (log metrics)
 */

import { MemoryProvider } from './provider'
import type {
  VectorDocument,
  VectorMetadata,
  SearchOptions,
  SearchResult,
  BatchResult,
  HealthStatus,
  ProviderCapabilities,
  ProviderConfig,
} from './types'

/**
 * A/B Router configuration
 */
export interface ABRouterConfig extends ProviderConfig {
  /** Percentage of traffic to route to experimental provider (0-100) */
  experimentPercentage?: number
  /** Enable shadow mode: query both providers and compare results */
  enableShadow?: boolean
  /** Enable metrics collection */
  enableMetrics?: boolean
  /** Name for experiment tracking */
  experimentName?: string
}

/**
 * Metrics collected during A/B testing
 */
export interface ABMetrics {
  provider: string
  operation: string
  latencyMs: number
  success: boolean
  error?: string
  timestamp: string
}

/**
 * Shadow comparison result
 */
export interface ShadowComparison {
  controlLatencyMs: number
  experimentLatencyMs: number
  controlResultCount: number
  experimentResultCount: number
  rankCorrelation: number
  recallAtK: number
  timestamp: string
}

/**
 * A/B Testing Router Provider
 */
export class ABRouterProvider extends MemoryProvider {
  private control: MemoryProvider
  private experiment: MemoryProvider
  private experimentPercentage: number
  private enableShadow: boolean
  private enableMetrics: boolean
  private experimentName: string
  private metrics: ABMetrics[] = []
  private comparisons: ShadowComparison[] = []

  constructor(
    config: ABRouterConfig,
    control: MemoryProvider,
    experiment: MemoryProvider
  ) {
    super(config)
    this.control = control
    this.experiment = experiment
    this.experimentPercentage =
      config.experimentPercentage ??
      parseInt(process.env.AB_RUVECTOR_PERCENTAGE || '0', 10)
    this.enableShadow =
      config.enableShadow ?? process.env.AB_ENABLE_SHADOW === 'true'
    this.enableMetrics =
      config.enableMetrics ?? process.env.AB_ENABLE_METRICS === 'true'
    this.experimentName = config.experimentName || 'ruvector-migration'
  }

  get name(): string {
    return `ab-router(${this.control.name}:${100 - this.experimentPercentage}%,${this.experiment.name}:${this.experimentPercentage}%)`
  }

  get capabilities(): ProviderCapabilities {
    return this.control.capabilities
  }

  /**
   * Get collected metrics
   */
  getMetrics(): ABMetrics[] {
    return [...this.metrics]
  }

  /**
   * Get shadow comparisons
   */
  getComparisons(): ShadowComparison[] {
    return [...this.comparisons]
  }

  /**
   * Clear collected metrics and comparisons
   */
  clearMetrics(): void {
    this.metrics = []
    this.comparisons = []
  }

  /**
   * Determine which provider to use based on percentage routing
   */
  private shouldUseExperiment(): boolean {
    return Math.random() * 100 < this.experimentPercentage
  }

  /**
   * Select provider based on routing decision
   */
  private selectProvider(): MemoryProvider {
    return this.shouldUseExperiment() ? this.experiment : this.control
  }

  /**
   * Record metrics for an operation
   */
  private recordMetric(
    provider: string,
    operation: string,
    latencyMs: number,
    success: boolean,
    error?: string
  ): void {
    if (!this.enableMetrics) return

    this.metrics.push({
      provider,
      operation,
      latencyMs,
      success,
      error,
      timestamp: new Date().toISOString(),
    })

    // Log to console for CloudWatch
    console.log(
      JSON.stringify({
        type: 'ab_metric',
        experiment: this.experimentName,
        provider,
        operation,
        latencyMs,
        success,
        error,
      })
    )
  }

  /**
   * Calculate Spearman rank correlation between two result sets
   */
  private calculateRankCorrelation(
    control: SearchResult[],
    experiment: SearchResult[]
  ): number {
    if (control.length === 0 || experiment.length === 0) return 0

    // Create rank maps
    const controlRanks = new Map<string, number>()
    control.forEach((r, i) => controlRanks.set(r.id, i + 1))

    const experimentRanks = new Map<string, number>()
    experiment.forEach((r, i) => experimentRanks.set(r.id, i + 1))

    // Find common IDs
    const commonIds = [...controlRanks.keys()].filter((id) =>
      experimentRanks.has(id)
    )

    if (commonIds.length < 2) return 0

    // Calculate Spearman correlation
    const n = commonIds.length
    let sumDSquared = 0

    for (const id of commonIds) {
      const d = (controlRanks.get(id) || 0) - (experimentRanks.get(id) || 0)
      sumDSquared += d * d
    }

    return 1 - (6 * sumDSquared) / (n * (n * n - 1))
  }

  /**
   * Calculate recall@k (how many of control's top-k appear in experiment)
   */
  private calculateRecallAtK(
    control: SearchResult[],
    experiment: SearchResult[],
    k = 10
  ): number {
    const controlTopK = new Set(control.slice(0, k).map((r) => r.id))
    const experimentTopK = new Set(experiment.slice(0, k).map((r) => r.id))

    if (controlTopK.size === 0) return 1

    let matches = 0
    for (const id of controlTopK) {
      if (experimentTopK.has(id)) {
        matches++
      }
    }

    return matches / controlTopK.size
  }

  // ============================================
  // EMBEDDING OPERATIONS
  // ============================================

  async generateEmbedding(text: string): Promise<number[]> {
    // Use control for embeddings (consistent across providers)
    return this.control.generateEmbedding(text)
  }

  // ============================================
  // VECTOR STORAGE OPERATIONS
  // ============================================

  async store(document: VectorDocument): Promise<void> {
    // Always write to both (for consistency)
    const start = Date.now()

    try {
      await this.control.store(document)
      this.recordMetric(
        this.control.name,
        'store',
        Date.now() - start,
        true
      )
    } catch (error) {
      this.recordMetric(
        this.control.name,
        'store',
        Date.now() - start,
        false,
        String(error)
      )
      throw error
    }

    // Write to experiment (non-blocking)
    const expStart = Date.now()
    this.experiment.store(document).then(
      () => {
        this.recordMetric(
          this.experiment.name,
          'store',
          Date.now() - expStart,
          true
        )
      },
      (error) => {
        this.recordMetric(
          this.experiment.name,
          'store',
          Date.now() - expStart,
          false,
          String(error)
        )
      }
    )
  }

  async storeBatch(documents: VectorDocument[]): Promise<BatchResult> {
    // Always write to both
    const start = Date.now()
    const controlResult = await this.control.storeBatch(documents)
    this.recordMetric(
      this.control.name,
      'storeBatch',
      Date.now() - start,
      controlResult.failed === 0
    )

    // Write to experiment (non-blocking)
    const expStart = Date.now()
    this.experiment.storeBatch(documents).then(
      (result) => {
        this.recordMetric(
          this.experiment.name,
          'storeBatch',
          Date.now() - expStart,
          result.failed === 0
        )
      },
      (error) => {
        this.recordMetric(
          this.experiment.name,
          'storeBatch',
          Date.now() - expStart,
          false,
          String(error)
        )
      }
    )

    return controlResult
  }

  async delete(id: string): Promise<void> {
    await this.control.delete(id)
    this.experiment.delete(id).catch(console.error)
  }

  async deleteBatch(ids: string[]): Promise<BatchResult> {
    const result = await this.control.deleteBatch(ids)
    this.experiment.deleteBatch(ids).catch(console.error)
    return result
  }

  async deleteByMeetingId(meetingId: string): Promise<BatchResult> {
    const result = await this.control.deleteByMeetingId(meetingId)
    this.experiment.deleteByMeetingId(meetingId).catch(console.error)
    return result
  }

  async updateMetadata(id: string, metadata: Partial<VectorMetadata>): Promise<void> {
    await this.control.updateMetadata(id, metadata)
    this.experiment.updateMetadata(id, metadata).catch(console.error)
  }

  // ============================================
  // SEARCH OPERATIONS
  // ============================================

  async search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]> {
    if (this.enableShadow) {
      // Shadow mode: query both and compare
      return this.shadowSearch(embedding, options)
    } else {
      // A/B mode: route to one provider
      const provider = this.selectProvider()
      const start = Date.now()

      try {
        const results = await provider.search(embedding, options)
        this.recordMetric(
          provider.name,
          'search',
          Date.now() - start,
          true
        )
        return results
      } catch (error) {
        this.recordMetric(
          provider.name,
          'search',
          Date.now() - start,
          false,
          String(error)
        )
        throw error
      }
    }
  }

  /**
   * Shadow search: query both providers and compare results
   * Returns control results, but logs comparison metrics
   */
  private async shadowSearch(
    embedding: number[],
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const controlStart = Date.now()
    const experimentStart = Date.now()

    const [controlResults, experimentResults] = await Promise.all([
      this.control.search(embedding, options).then((r) => {
        this.recordMetric(
          this.control.name,
          'search',
          Date.now() - controlStart,
          true
        )
        return r
      }),
      this.experiment.search(embedding, options).then((r) => {
        this.recordMetric(
          this.experiment.name,
          'search',
          Date.now() - experimentStart,
          true
        )
        return r
      }).catch((error) => {
        this.recordMetric(
          this.experiment.name,
          'search',
          Date.now() - experimentStart,
          false,
          String(error)
        )
        return [] as SearchResult[]
      }),
    ])

    // Record comparison
    const comparison: ShadowComparison = {
      controlLatencyMs: Date.now() - controlStart,
      experimentLatencyMs: Date.now() - experimentStart,
      controlResultCount: controlResults.length,
      experimentResultCount: experimentResults.length,
      rankCorrelation: this.calculateRankCorrelation(controlResults, experimentResults),
      recallAtK: this.calculateRecallAtK(controlResults, experimentResults),
      timestamp: new Date().toISOString(),
    }

    this.comparisons.push(comparison)

    // Log comparison for CloudWatch
    console.log(
      JSON.stringify({
        type: 'ab_comparison',
        experiment: this.experimentName,
        ...comparison,
      })
    )

    // Always return control results
    return controlResults
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now()

    const [controlHealth, experimentHealth] = await Promise.all([
      this.control.healthCheck(),
      this.experiment.healthCheck(),
    ])

    const bothHealthy = controlHealth.healthy && experimentHealth.healthy

    const errors: string[] = []
    if (!controlHealth.healthy) {
      errors.push(`control: ${controlHealth.error}`)
    }
    if (!experimentHealth.healthy) {
      errors.push(`experiment: ${experimentHealth.error}`)
    }

    return {
      healthy: bothHealthy,
      provider: this.name,
      latencyMs: Date.now() - start,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    }
  }

  async getVectorCount(): Promise<number> {
    return this.control.getVectorCount()
  }

  /**
   * Get summary statistics for A/B test
   */
  getSummary(): {
    controlAvgLatency: number
    experimentAvgLatency: number
    avgRankCorrelation: number
    avgRecallAtK: number
    sampleCount: number
  } {
    const controlMetrics = this.metrics.filter(
      (m) => m.provider === this.control.name && m.operation === 'search'
    )
    const experimentMetrics = this.metrics.filter(
      (m) => m.provider === this.experiment.name && m.operation === 'search'
    )

    const avg = (nums: number[]) =>
      nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0

    return {
      controlAvgLatency: avg(controlMetrics.map((m) => m.latencyMs)),
      experimentAvgLatency: avg(experimentMetrics.map((m) => m.latencyMs)),
      avgRankCorrelation: avg(this.comparisons.map((c) => c.rankCorrelation)),
      avgRecallAtK: avg(this.comparisons.map((c) => c.recallAtK)),
      sampleCount: this.comparisons.length,
    }
  }
}

/**
 * Create A/B router with default configuration
 */
export function createABRouterProvider(
  control: MemoryProvider,
  experiment: MemoryProvider,
  config?: Partial<ABRouterConfig>
): ABRouterProvider {
  return new ABRouterProvider(
    {
      experimentPercentage: parseInt(
        process.env.AB_RUVECTOR_PERCENTAGE || '10',
        10
      ),
      enableShadow: process.env.AB_ENABLE_SHADOW === 'true',
      enableMetrics: process.env.AB_ENABLE_METRICS === 'true',
      experimentName: 'ruvector-migration',
      ...config,
    },
    control,
    experiment
  )
}
