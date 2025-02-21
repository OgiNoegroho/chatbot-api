// src/services/performance.ts
export class PerformanceMonitor {
  private metrics: {
    startTime: number;
    connections: number;
    operations: Map<string, number[]>;
    errors: Map<string, number>;
    lastGC?: number;
  };

  constructor() {
    this.metrics = {
      startTime: Date.now(),
      connections: 0,
      operations: new Map(),
      errors: new Map(),
    };
  }

  trackConnection() {
    this.metrics.connections++;
  }

  trackDisconnection() {
    this.metrics.connections--;
  }

  trackOperation(operation: string, duration: number) {
    if (!this.metrics.operations.has(operation)) {
      this.metrics.operations.set(operation, []);
    }
    this.metrics.operations.get(operation)!.push(duration);

    // Keep only last 1000 measurements
    if (this.metrics.operations.get(operation)!.length > 1000) {
      this.metrics.operations.get(operation)!.shift();
    }
  }

  trackError(operation: string) {
    const current = this.metrics.errors.get(operation) || 0;
    this.metrics.errors.set(operation, current + 1);
  }

  getHealthMetrics() {
    return {
      status: "ok",
      uptime: Math.floor((Date.now() - this.metrics.startTime) / 1000),
      connections: this.metrics.connections,
      memory: process.memoryUsage(),
      lastGC: this.metrics.lastGC,
    };
  }

  getDetailedMetrics() {
    const operationMetrics = new Map();

    this.metrics.operations.forEach((durations, operation) => {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const max = Math.max(...durations);
      const min = Math.min(...durations);

      operationMetrics.set(operation, {
        count: durations.length,
        avgDuration: Math.round(avg),
        maxDuration: max,
        minDuration: min,
        errors: this.metrics.errors.get(operation) || 0,
      });
    });

    return {
      uptime: Math.floor((Date.now() - this.metrics.startTime) / 1000),
      connections: this.metrics.connections,
      memory: process.memoryUsage(),
      operations: Object.fromEntries(operationMetrics),
      errors: Object.fromEntries(this.metrics.errors),
    };
  }
}
