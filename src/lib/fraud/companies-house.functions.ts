// Public server function for the signup company picker. Kept out of the
// .server module so client code can import it (the framework strips the body).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { searchCompanies } from "./companies-house.server";

export const searchCompaniesHouse = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ query: z.string().trim().min(2).max(100) }).parse(d))
  .handler(async ({ data }) => {
    return await searchCompanies(data.query);
  });
