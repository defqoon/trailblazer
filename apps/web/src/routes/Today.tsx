import { useQuery } from "@tanstack/react-query";
import { Placeholder } from "../components/Placeholder";
import { api } from "../lib/api";

export function TodayPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ email: string }>("/me") });
  return (
    <Placeholder title="Today">
      {me.isPending && "Connecting…"}
      {me.isError && "Couldn't reach the API. Are you signed in through Cloudflare Access?"}
      {me.data && <>Signed in as {me.data.email}. Today's workout and nutrition targets show up here.</>}
    </Placeholder>
  );
}
