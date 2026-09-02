import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const AUTH_SERVER_INTERNAL_URL =
  process.env.AUTH_SERVER_INTERNAL_URL || 'http://auth_server:8000';

/**
 * BFF (Backend-for-Frontend) Proxy
 *
 * Incoming:  /api/proxy/<path...>
 * Outgoing:  http://auth_server:8000/<path...>
 *
 * The Next.js server reads the mgmt_access_token HttpOnly cookie (which the
 * browser cannot read) and injects it as an Authorization header when calling
 * the upstream auth_server.  This way, sensitive tokens never have to be
 * exposed to client-side JavaScript.
 */
async function proxyHandler(request, { params }) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('mgmt_access_token')?.value;

  // Build upstream URL:  /api/proxy/api/v1/users  ->  http://auth_server:8000/api/v1/users
  const pathSegments = (await params).path || [];
  const upstreamPath = pathSegments.join('/');
  const upstreamUrl = new URL(upstreamPath, AUTH_SERVER_INTERNAL_URL + '/');

  // Forward original query string
  const searchParams = new URL(request.url).searchParams;
  searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));

  // Build forwarded headers - inject Authorization if we have a token
  const forwardHeaders = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) forwardHeaders.set('content-type', contentType);
  if (accessToken) forwardHeaders.set('authorization', `Bearer ${accessToken}`);

  // Read body for mutating methods
  let body = undefined;
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    body = await request.arrayBuffer();
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      method,
      headers: forwardHeaders,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Upstream auth server unreachable', detail: err.message },
      { status: 502 }
    );
  }

  const responseBody = await upstreamResponse.arrayBuffer();
  const responseHeaders = new Headers();
  const upstreamContentType = upstreamResponse.headers.get('content-type');
  if (upstreamContentType) responseHeaders.set('content-type', upstreamContentType);

  return new NextResponse(responseBody, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export const GET = proxyHandler;
export const POST = proxyHandler;
export const PUT = proxyHandler;
export const PATCH = proxyHandler;
export const DELETE = proxyHandler;
