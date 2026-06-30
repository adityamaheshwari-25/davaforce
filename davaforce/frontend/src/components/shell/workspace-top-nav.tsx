"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DavaForceWordmark } from "@/components/davaforce-wordmark";
import { useThemePreference } from "@/hooks/use-theme-preference";
import { ParticleToggle } from "@/components/shell/particle-toggle";
import { UserRoleMenu } from "@/components/shell/user-role-menu";

type LoginUser = {
  userId: string;
  username: string;
  profileImage?: string;
};

export function WorkspaceTopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { toggleTheme } = useThemePreference();
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("sarah");
  const [profileImage, setProfileImage] = useState("");
  const [hasDataset, setHasDataset] = useState(false);
  const isDashboard = pathname === "/dashboard";
  const workspaceActionHref = isDashboard ? "/workspace" : "/dashboard";
  const workspaceActionLabel = isDashboard ? "Open chat workspace" : "Open dashboard";

  useEffect(() => {
    const syncDatasetState = () => {
      setHasDataset(Boolean(window.localStorage.getItem("workforceDatasetId")));
    };

    const storedUser = window.localStorage.getItem("workforceUser");
    syncDatasetState();
    window.addEventListener("workforce-dataset-changed", syncDatasetState);
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser) as LoginUser;
        if (parsed.userId) {
          setUserId(parsed.userId);
        }
        if (parsed.username) {
          setUsername(parsed.username);
        }
        if (parsed.profileImage) {
          setProfileImage(parsed.profileImage);
        }
      } catch {
        window.localStorage.removeItem("workforceUser");
      }
    }

    return () => {
      window.removeEventListener("workforce-dataset-changed", syncDatasetState);
    };
  }, []);

  const logout = () => {
    window.localStorage.removeItem("workforceUser");
    window.localStorage.removeItem("workforceDatasetId");
    window.localStorage.removeItem("workforceDatasetName");
    window.localStorage.removeItem("workforceDatasetSchemaValidated");
    window.localStorage.removeItem("workforcePrompt");
    router.push("/");
  };

  return (
    <nav className="relative z-10 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[92rem] items-center justify-between rounded-2xl border border-[var(--home-border)] bg-[var(--home-panel)] px-4 py-2.5 shadow-2xl shadow-black/10 backdrop-blur transition-[background-color,border-color,box-shadow] duration-300 md:px-5">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <img src="/assets/davaforce-logo-mark.png" alt="" className="h-12 w-12 shrink-0 object-contain" />
          <DavaForceWordmark />
        </Link>
        <div className="flex shrink-0 items-center gap-3 sm:gap-5">
          {/* <ParticleToggle /> */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-[var(--home-text)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            <Moon className="h-4 w-4 dark:hidden" />
            <Sun className="hidden h-4 w-4 dark:block" />
          </Button>
          {hasDataset ? (
            <Button asChild className="h-12 rounded-lg bg-brand px-6 text-base font-semibold text-brand-foreground hover:bg-brand/90">
              <Link href={workspaceActionHref}>
                {workspaceActionLabel} <ArrowRight className="ml-1 h-5 w-5" />
              </Link>
            </Button>
          ) : null}
          <UserRoleMenu userId={userId} username={username} profileImage={profileImage} onSignOut={logout} />
        </div>
      </div>
    </nav>
  );
}
