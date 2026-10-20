import { handleCapi } from "./capi.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/capi") {
      if (request.method !== "POST") {
        return new Response("Método não permitido", { status: 405, headers: { Allow: "POST" } });
      }
      return handleCapi(request, env);
    }

    // Todo o resto é o site estático (pasta public/)
    return env.ASSETS.fetch(request);
  }
};
