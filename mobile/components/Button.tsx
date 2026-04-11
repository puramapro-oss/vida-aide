import { ActivityIndicator, Pressable, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";

type Props = {
  onPress?: () => void;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
};

export function Button({
  onPress,
  children,
  variant = "primary",
  loading,
  disabled,
  testID,
}: Props) {
  const handlePress = () => {
    if (loading || disabled || !onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  if (variant === "primary") {
    return (
      <Pressable
        onPress={handlePress}
        testID={testID}
        accessibilityRole="button"
        disabled={loading || disabled}
        style={({ pressed }) => ({
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          borderRadius: 14,
          overflow: "hidden",
        })}
      >
        <LinearGradient
          colors={["#10B981", "#059669"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingVertical: 16,
            paddingHorizontal: 24,
            alignItems: "center",
            justifyContent: "center",
            minHeight: 52,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text
              style={{
                color: "#fff",
                fontWeight: "600",
                fontSize: 16,
                letterSpacing: 0.3,
              }}
            >
              {children}
            </Text>
          )}
        </LinearGradient>
      </Pressable>
    );
  }

  if (variant === "secondary") {
    return (
      <Pressable
        onPress={handlePress}
        testID={testID}
        accessibilityRole="button"
        disabled={loading || disabled}
        style={({ pressed }) => ({
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          borderRadius: 14,
          paddingVertical: 16,
          paddingHorizontal: 24,
          alignItems: "center",
          justifyContent: "center",
          minHeight: 52,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
          backgroundColor: "rgba(255,255,255,0.04)",
        })}
      >
        {loading ? (
          <ActivityIndicator color="#F59E0B" />
        ) : (
          <Text style={{ color: "#F5F5F7", fontWeight: "600", fontSize: 16 }}>
            {children}
          </Text>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      testID={testID}
      accessibilityRole="button"
      disabled={loading || disabled}
      style={({ pressed }) => ({
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text style={{ color: "#F59E0B", fontWeight: "600", fontSize: 15 }}>
        {children}
      </Text>
    </Pressable>
  );
}
