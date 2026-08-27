import type { User } from "../generated/prisma/client.js";

declare module "fastify" {
  interface FastifyRequest {
    firebaseUid: string;
    appUser: User;
  }
}
