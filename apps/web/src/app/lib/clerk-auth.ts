import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const requireClerkUserId = async () => {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  return userId;
};
