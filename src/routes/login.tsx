import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { loginFn } from "../lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await loginFn({ data: { email, password } });

      if (result.success) {
        toast.success("Successfully logged in");
        router.navigate({ to: "/" });
      } else {
        toast.error(result.error || "Login failed");
      }
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md bg-card rounded-xl shadow-lg border p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <LockKeyhole className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Receipt Roamer</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Enter your secure credentials to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="email">
              Email Address
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <Button type="submit" className="w-full mt-4" disabled={isLoading}>
            {isLoading ? "Authenticating..." : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
