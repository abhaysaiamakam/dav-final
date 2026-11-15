interface Env {
  ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);

    if (!env.ORIGIN) {
      return new Response("CropLens origin is not configured.", { status: 503 });
    }

    let upstream: URL;
    try {
      upstream = new URL(env.ORIGIN);
      if (upstream.protocol !== "https:") throw new Error("ORIGIN must use HTTPS");
    } catch {
      return new Response("CropLens origin is invalid.", { status: 503 });
    }

    upstream.pathname = `${upstream.pathname.replace(/\/$/, "")}${incoming.pathname}`;
    upstream.search = incoming.search;

    try {
      return await fetch(new Request(upstream, request));
    } catch {
      return new Response("CropLens is offline. Start the Docker stack and Cloudflare Tunnel.", {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
