import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

/**
 * Round player photo. Shows the player's initial until the photo has
 * actually loaded (and keeps it if the photo fails), so a list of players
 * never shows empty circles.
 */
export function PlayerAvatar({
  uri,
  name,
  size = 44,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [uri]);

  const initial = (name ?? '').trim().replace(/^@/, '').charAt(0).toUpperCase() || '?';

  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          resizeMethod="resize"
          style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  initial: {
    fontFamily: 'Inter-Bold',
    color: '#ffffff',
  },
});
