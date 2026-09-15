import { Icon } from "@bb/shared-ui/icon";
import { buttonVariants } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { Link } from "react-router-dom";

export function OpenPluginGuideButton() {
  return (
    <Link
      to="/plugins/plugin-api-docs/plugin-api"
      className={cn(
        buttonVariants({ variant: "link", size: "sm" }),
        "shrink-0 gap-1.5 px-0 text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon name="Explore" className="size-4" aria-hidden />
      <span className="underline underline-offset-4">Plugin Guide</span>
    </Link>
  );
}
