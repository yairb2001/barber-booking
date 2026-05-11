// ─── OTP Input — 6 single-digit boxes ────────────────────────────────────────
import React, { useRef, useState } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import type { AppTheme } from "@/lib/theme";

type Props = {
  value: string;
  onChange: (val: string) => void;
  theme: AppTheme;
};

export default function OtpInput({ value, onChange, theme }: Props) {
  const inputs = useRef<(TextInput | null)[]>([]);

  const handleChange = (text: string, index: number) => {
    const digit = text.replace(/\D/g, "").slice(-1);
    const chars = value.split("");
    chars[index] = digit;
    const next = chars.join("").slice(0, 6);
    onChange(next);

    if (digit && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: { nativeEvent: { key: string } }, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !value[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  return (
    <View style={styles.row}>
      {Array.from({ length: 6 }).map((_, i) => (
        <TextInput
          key={i}
          ref={(r) => { inputs.current[i] = r; }}
          style={[
            styles.box,
            {
              backgroundColor: theme.card,
              borderColor: value[i] ? theme.brand : theme.divider,
              color: theme.textPri,
            },
          ]}
          value={value[i] ?? ""}
          onChangeText={(t) => handleChange(t, i)}
          onKeyPress={(e) => handleKeyPress(e, i)}
          keyboardType="number-pad"
          maxLength={1}
          textAlign="center"
          selectTextOnFocus
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  box: {
    width: 44,
    height: 52,
    borderRadius: 10,
    borderWidth: 2,
    fontSize: 22,
    fontWeight: "700",
  },
});
