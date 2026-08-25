import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/api-response.interface';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

const DEFAULT_MESSAGES: Record<string, string> = {
  GET: 'Data retrieved successfully',
  POST: 'Resource created successfully',
  PUT: 'Resource updated successfully',
  PATCH: 'Resource updated successfully',
  DELETE: 'Resource deleted successfully',
};

/** Wraps every successful response in one consistent envelope. */
@Injectable()
export class ResponseFormatInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const customMessage = this.reflector.get<string>(
      RESPONSE_MESSAGE_KEY,
      context.getHandler(),
    );

    return next.handle().pipe(
      map((data: T) => ({
        success: true,
        message:
          customMessage ??
          DEFAULT_MESSAGES[request.method] ??
          'Operation completed successfully',
        data,
        timestamp: new Date().toISOString(),
        path: request.url,
        statusCode: response.statusCode,
      })),
    );
  }
}
