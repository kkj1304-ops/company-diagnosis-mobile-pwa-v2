import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const VISITS_KEY = 'company-diagnosis-mobile-pwa-v2:total-visits';
const UNIQUE_VISITORS_KEY = 'company-diagnosis-mobile-pwa-v2:unique-visitors';

function redisEnabled() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function getRedis() {
  return Redis.fromEnv();
}

function cleanVisitorId(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

export async function GET() {
  if (!redisEnabled()) {
    return NextResponse.json({
      enabled: false,
      totalVisits: null,
      uniqueVisitors: null,
      message: 'Redis environment variables are not configured.',
    });
  }

  try {
    const redis = getRedis();

    const [totalVisitsRaw, uniqueVisitors] = await Promise.all([
      redis.get<number>(VISITS_KEY),
      redis.scard(UNIQUE_VISITORS_KEY),
    ]);

    return NextResponse.json({
      enabled: true,
      totalVisits: Number(totalVisitsRaw ?? 0),
      uniqueVisitors: Number(uniqueVisitors ?? 0),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        enabled: false,
        totalVisits: null,
        uniqueVisitors: null,
        message: error?.message ?? 'Failed to read visit stats.',
      },
      { status: 200 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!redisEnabled()) {
    return NextResponse.json({
      enabled: false,
      totalVisits: null,
      uniqueVisitors: null,
      message: 'Redis environment variables are not configured.',
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const visitorId = cleanVisitorId(body?.visitorId);

    const redis = getRedis();

    const totalVisits = await redis.incr(VISITS_KEY);

    if (visitorId) {
      await redis.sadd(UNIQUE_VISITORS_KEY, visitorId);
    }

    const uniqueVisitors = await redis.scard(UNIQUE_VISITORS_KEY);

    return NextResponse.json({
      enabled: true,
      totalVisits,
      uniqueVisitors,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        enabled: false,
        totalVisits: null,
        uniqueVisitors: null,
        message: error?.message ?? 'Failed to update visit stats.',
      },
      { status: 200 },
    );
  }
}
