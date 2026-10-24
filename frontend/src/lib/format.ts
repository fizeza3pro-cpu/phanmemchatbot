import type { Conversation } from './types';
import { MODEL_NAMES, type ModelId } from '../../../backend/shared/models';
const numberFormat = new Intl.NumberFormat('vi-VN');
export const formatNumber = (value: number | null | undefined) =>
  numberFormat.format(value ?? 0);
export const formatDate = (value: number) =>
  new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
export const modelName = (model: string) =>
  MODEL_NAMES[model as ModelId] ?? model;
export const stateName = (status: Conversation['status']) =>
  ({
    active: 'Sẵn sàng',
    processing: 'Đang trả lời',
    usage_pending: 'Chờ xác nhận',
    limit_reached: 'Cần phiên mới',
    archived: 'Đã lưu trữ',
    deleted: 'Đã xóa',
  })[status];
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
