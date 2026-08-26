import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { TransientProviderError } from '../../../common/errors/payroll.errors';
import { PayrollEvent } from '../../events/entities/payroll-event.entity';

export interface ProviderResult {
  provider: string;
  externalRef: string;
  acknowledgedAt: string;
}

@Injectable()
export class PayrollProviderService {
  private readonly failureRate: number;
  private readonly latencyMs: number;

  constructor(configService: ConfigService) {
    this.failureRate = Number(
      configService.get<number>('PROVIDER_FAILURE_RATE', 0.3),
    );
    this.latencyMs = Number(
      configService.get<number>('PROVIDER_LATENCY_MS', 1500),
    );
  }

  async apply(event: PayrollEvent): Promise<ProviderResult> {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));

    if (Math.random() < this.failureRate) {
      throw new TransientProviderError(
        'PROVIDER_UNAVAILABLE',
        `Payroll provider did not acknowledge event ${event.id}`,
        { failureRate: this.failureRate },
      );
    }

    return {
      provider: 'simulated-payroll',
      externalRef: this.referenceFor(event),
      acknowledgedAt: new Date().toISOString(),
    };
  }

  private referenceFor(event: PayrollEvent): string {
    return `PRV-${createHash('sha1')
      .update(event.id)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase()}`;
  }
}
