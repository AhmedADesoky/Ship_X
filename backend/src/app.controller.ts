import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // A real target for a load balancer/uptime monitor — checks the DB is
  // actually reachable, not just that the Node process is up.
  @Public()
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error' };
    }
  }
}
