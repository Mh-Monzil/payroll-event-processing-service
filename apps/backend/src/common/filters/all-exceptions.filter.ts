import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface';
import {
  PermanentPayrollError,
  UnknownEventTypeError,
} from '../errors/payroll.errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const asRecord = body as Record<string, unknown>;
        message = (asRecord.message as string) ?? exception.message;
        error = asRecord;
      }
    } else if (exception instanceof UnknownEventTypeError) {
      status = HttpStatus.BAD_REQUEST;
      message = exception.message;
      error = { code: 'UNKNOWN_EVENT_TYPE', knownTypes: exception.knownTypes };
    } else if (exception instanceof PermanentPayrollError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      message = exception.message;
      error = { code: exception.code, detail: exception.detail };
    } else if (exception instanceof Error) {
      message = 'Internal server error';
      error = { code: 'INTERNAL_ERROR' };
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
    }

    const body: ApiResponse = {
      success: false,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      statusCode: status,
    };

    response.status(status).json(body);
  }
}
