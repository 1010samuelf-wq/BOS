import { Redirect } from "expo-router";
import React from "react";

import { useAuth } from "../src/auth/AuthContext";

export default function Index() {
  const { user, ready } = useAuth();
  if (!ready) return null; // storage hydration — a frame or two
  return user ? <Redirect href="/(main)/orders" /> : <Redirect href="/login" />;
}
