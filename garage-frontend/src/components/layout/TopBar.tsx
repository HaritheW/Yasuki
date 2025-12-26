import { useState } from "react";
import { Bell, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type NotificationEntry = {
  id: number;
  title: string;
  message: string;
  type: string | null;
  is_read: boolean;
  created_at: string;
};

const NOTIFICATIONS_QUERY_KEY = ["notifications"];

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const IST_DATE_TIME_FORMATTER = Intl.DateTimeFormat(undefined, {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const parseNotificationTimestamp = (timestamp: string) => {
  if (!timestamp) return null;
  const normalized = timestamp.trim().replace(" ", "T");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const fallback = new Date(`${normalized}+05:30`);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }
  return null;
};

const formatNotificationTimestamp = (timestamp: string) => {
  if (!timestamp) return "";
  const parsed = parseNotificationTimestamp(timestamp);
  if (!parsed) return timestamp;

  const now = new Date();
  const diffMs = parsed.getTime() - now.getTime();

  const divisions: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.34524],
    ["month", 12],
    ["year", Number.POSITIVE_INFINITY],
  ];

  let unit: Intl.RelativeTimeFormatUnit = "second";
  let duration = diffMs / 1000;
  for (const [nextUnit, amount] of divisions) {
    if (Math.abs(duration) < amount) {
      unit = nextUnit;
      break;
    }
    duration /= amount;
  }

  const relativeLabel = RELATIVE_TIME_FORMATTER.format(Math.round(duration), unit);
  const absoluteLabel = IST_DATE_TIME_FORMATTER.format(parsed);

  return `${relativeLabel} (${absoluteLabel} IST)`;
};

export function TopBar() {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const notificationsQuery = useQuery<NotificationEntry[], Error>({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => apiFetch<NotificationEntry[]>("/notifications?limit=all"),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: [],
  });

  const markAllReadMutation = useMutation<{ updated: number }, Error>({
    mutationFn: () =>
      apiFetch<{ updated: number }>("/notifications/mark-all-read", {
        method: "PATCH",
      }),
    onSuccess: () => {
      queryClient.setQueryData<NotificationEntry[] | undefined>(
        NOTIFICATIONS_QUERY_KEY,
        (prev) => prev?.map((entry) => ({ ...entry, is_read: true }))
      );
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: "Unable to update notifications",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = notifications.filter((entry) => !entry.is_read).length;

  const handleNotificationsOpenChange = (open: boolean) => {
    setNotificationsOpen(open);
    if (open && unreadCount > 0 && !markAllReadMutation.isPending) {
      markAllReadMutation.mutate();
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-4">
      </div>
      <div className="flex items-center gap-3">
        <DropdownMenu open={notificationsOpen} onOpenChange={handleNotificationsOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative focus-visible:ring-0 focus-visible:ring-offset-0">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-[10px] top-[10px] inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={12} className="w-80 p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <DropdownMenuLabel className="p-0 text-sm font-semibold">Notifications</DropdownMenuLabel>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(event) => {
                  event.preventDefault();
                  notificationsQuery.refetch();
                }}
                disabled={notificationsQuery.isFetching}
              >
                <RefreshCw
                  className={cn("h-4 w-4", notificationsQuery.isFetching ? "animate-spin text-muted-foreground" : "")}
                />
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {notificationsQuery.isError ? (
                <div className="px-4 py-6 text-sm text-destructive">
                  {notificationsQuery.error?.message ?? "Unable to load notifications."}
                </div>
              ) : notificationsQuery.isLoading ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">Loading notifications...</div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No notifications yet.</div>
              ) : (
                <div className="divide-y">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={cn(
                        "px-4 py-3 text-sm transition-colors",
                        notification.is_read ? "bg-background" : "bg-muted/40"
                      )}
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="font-semibold leading-tight text-foreground">{notification.title}</p>
                          <p className="text-sm text-muted-foreground">{notification.message}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 text-right">
                          {notification.type && (
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-foreground">
                              {notification.type.replace(/-/g, " ")}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatNotificationTimestamp(notification.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DropdownMenuSeparator className="mt-0" />
            <div className="px-4 py-2 text-xs text-muted-foreground">
              Notifications update automatically every 30 seconds.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
