import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export interface JwtPayload {
  id: string;
  username: string;
  role: "visitor" | "associate" | "admin" | "superadmin";
  /** Club scope. Null only for superadmin (platform, outside clubs). */
  clubId: string | null;
  /** Impersonation grant id — present when a superadmin acts as club admin. */
  imp?: string;
  preferred_language?: "it" | "en" | "fr" | "de" | "es";
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (roles: string[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSuperadmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    // Pre-multitenancy tokens carry no club scope — they must re-login.
    const user = (req as any).user as JwtPayload | undefined;
    if (user && user.role !== "superadmin" && !user.clubId) {
      return reply.status(401).send({ error: "Session expired — please login again" });
    }
  });

  fastify.decorate("requireRole", (roles: string[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user as JwtPayload | undefined;
      if (!user || !roles.includes(user.role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
    };
  });

  fastify.decorate("requireSuperadmin", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtPayload | undefined;
    if (!user || user.role !== "superadmin") {
      return reply.status(403).send({ error: "Forbidden" });
    }
  });
});
