export class NextRequest extends Request {
  get nextUrl() {
    return new URL(this.url);
  }
}

export class NextResponse extends Response {
  static redirect(url, init = 307) {
    const options = typeof init === 'number' ? { status: init } : init;
    const headers = new Headers(options.headers);
    headers.set('Location', String(url));
    return new NextResponse(null, { ...options, headers, status: options.status ?? 307 });
  }
}
