import { StyleSheet } from 'react-native';

export const COLORS = {
  background: '#000',
  card: '#0A0A0A',
  border: '#1A1A1A',
  primary: '#2962FF',
  success: '#00C853',
  danger: '#FF5252',
  warning: '#FFD600',
  textPrimary: '#FFF',
  textSecondary: '#666',
  textMuted: '#444',
  long: '#00C853',
  short: '#FF5252',
  pro: '#FFA500',
};

export const globalStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  card: { 
    backgroundColor: COLORS.card, 
    borderRadius: 24, 
    padding: 24, 
    borderWidth: 1, 
    borderColor: COLORS.border,
    marginBottom: 20
  },
  textPrimary: { color: COLORS.textPrimary },
  textSecondary: { color: COLORS.textSecondary },
  longColor: { color: COLORS.long },
  shortColor: { color: COLORS.short },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 20 },
  sectionSubTitle: { 
    color: COLORS.primary, 
    fontSize: 12, 
    fontWeight: 'bold', 
    marginBottom: 15, 
    textTransform: 'uppercase' 
  },
});
