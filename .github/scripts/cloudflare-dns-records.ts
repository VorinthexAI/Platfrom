export type DesiredRecord = {
  name: string;
  type: "A" | "CNAME";
  content: string;
  proxied: boolean;
  ttl: number;
};

export function desiredDnsRecords(hostnames: string[], target: string, apex: string, apiAddress: string): DesiredRecord[] {
  return hostnames.map((name) => {
    const directApi = name === `api.${apex}`;
    return {
      name,
      type: directApi ? "A" : "CNAME",
      content: directApi ? apiAddress : target,
      proxied: !directApi,
      ttl: directApi ? 300 : 1,
    };
  });
}
