import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { FileIcon } from "@vorinthex/shared/ui/icons-mobile";

import { ListRow } from "@/components/ListRow";
import { fetchCapabilityContent } from "@/data/mock";

export function ArchiveContent() {
  const { data } = useQuery({
    queryKey: ["capability", "archive"],
    queryFn: () => fetchCapabilityContent("archive"),
  });

  return (
    <View style={{ gap: 10 }}>
      {(data ?? []).map((item) => (
        <ListRow
          key={item.id}
          icon={<FileIcon size="sm" variant="accent" />}
          title={item.title}
          subtitle={item.meta}
        />
      ))}
    </View>
  );
}
