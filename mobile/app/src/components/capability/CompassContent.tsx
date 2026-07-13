import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { LocationPinIcon } from "@vorinthex/shared/ui/icons-mobile";

import { ListRow } from "@/components/ListRow";
import { fetchCapabilityContent } from "@/data/mock";

export function CompassContent() {
  const { data } = useQuery({
    queryKey: ["capability", "compass"],
    queryFn: () => fetchCapabilityContent("compass"),
  });

  return (
    <View style={{ gap: 10 }}>
      {(data ?? []).map((item) => (
        <ListRow
          key={item.id}
          icon={<LocationPinIcon size="sm" variant="accent" />}
          title={item.place}
          subtitle={item.note}
        />
      ))}
    </View>
  );
}
