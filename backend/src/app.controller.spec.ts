import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let prismaMock: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prismaMock = { $queryRaw: jest.fn(() => Promise.resolve([{ '?column?': 1 }])) };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    const makeRes = () => ({ status: jest.fn() }) as any;

    it('returns ok when the DB is reachable', async () => {
      const res = makeRes();
      const result = await appController.health(res);
      expect(result).toEqual({ status: 'ok' });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 503 when the DB is unreachable', async () => {
      prismaMock.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
      const res = makeRes();
      const result = await appController.health(res);
      expect(result).toEqual({ status: 'error' });
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
