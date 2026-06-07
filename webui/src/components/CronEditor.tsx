import { useEffect, useMemo, useState } from 'react';
import {
  Select,
  TimePicker,
  Checkbox,
  InputNumber,
  Space,
  Typography,
  Divider,
  Alert,
  Button,
} from 'antd';
import {
  ClockCircleOutlined,
  BulbOutlined,
  CalendarOutlined,
  PlusOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

const { Text } = Typography;

// ── Types ───────────────────────────────────────────────────────────
export type Frequency =
  | 'every-minute'
  | 'every-5-min'
  | 'every-15-min'
  | 'every-30-min'
  | 'every-N-hours'
  | 'daily'
  | 'weekly'
  | 'monthly';

export const PRESET_LABELS: Record<Frequency, string> = {
  'every-minute': '每分钟',
  'every-5-min': '每 5 分钟',
  'every-15-min': '每 15 分钟',
  'every-30-min': '每 30 分钟',
  'every-N-hours': '每 N 小时',
  'daily': '每天',
  'weekly': '每周',
  'monthly': '每月',
};

const WEEKDAYS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
];

const HOURS_INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 8, 12];

// ── Utilities ───────────────────────────────────────────────────────
export function describeCron(cron: string): string {
  if (!cron) return '无效';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return '无效 (需要 5 字段)';

  const [minute, hour, day, month, weekday] = parts;

  if (cron === '* * * * *') return '每分钟执行';
  if (minute.startsWith('*/')) {
    return `每 ${minute.slice(2)} 分钟执行`;
  }
  if (minute === '0' && hour.startsWith('*/')) {
    return `每 ${hour.slice(2)} 小时整点执行`;
  }

  // Multi-time pattern: "m1,m2 h1,h2 * * *"
  const minutes = minute.split(',');
  const hours = hour.split(',');
  const hasMultiTime = minutes.length > 1 || hours.length > 1;
  // Get cartesian product count (for warning)
  const isCartesian = minutes.length > 1 && hours.length > 1;
  const timesCount = isCartesian ? minutes.length * hours.length : Math.max(minutes.length, hours.length, 1);

  const formatTimeList = (): string => {
    if (minutes.length === 1) {
      const m = minutes[0].padStart(2, '0');
      return hours.map((h) => `${h.padStart(2, '0')}:${m}`).join('、');
    }
    // minutes differ - show cartesian product
    return hours
      .map((h) => minutes.map((m) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`).join('、'))
      .join('、');
  };

  if (hasMultiTime && day === '*' && month === '*' && weekday === '*') {
    return `每天 ${formatTimeList()} 执行 (${timesCount} 次/天)`;
  }
  if (hasMultiTime && weekday !== '*' && day === '*' && month === '*') {
    const dayLabels = weekday
      .split(',')
      .map((d) => WEEKDAYS.find((wd) => String(wd.value) === d)?.label || `周${d}`)
      .join('、');
    return `每${dayLabels} ${formatTimeList()} 执行`;
  }
  if (hasMultiTime && day !== '*' && month === '*' && weekday === '*') {
    return `每月 ${day} 日 ${formatTimeList()} 执行`;
  }

  // Single time pattern
  if (hour !== '*' && minute !== '*' && day === '*' && month === '*' && weekday === '*') {
    return `每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} 执行`;
  }
  if (weekday !== '*' && hour !== '*' && minute !== '*' && day === '*' && month === '*') {
    const dayLabel = WEEKDAYS.find((d) => String(d.value) === weekday)?.label || `周${weekday}`;
    return `每${dayLabel} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} 执行`;
  }
  if (day !== '*' && hour !== '*' && minute !== '*' && month === '*' && weekday === '*') {
    return `每月 ${day} 日 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} 执行`;
  }

  return `Cron: ${cron}`;
}

export function isValidCron(cron: string): boolean {
  if (!cron) return false;
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5;
}

export function buildCron(opts: {
  frequency: Frequency;
  hoursInterval?: number;
  times?: Dayjs[];
  weekdays?: number[];
  dayOfMonth?: number;
}): string {
  const { frequency, hoursInterval, times, weekdays, dayOfMonth } = opts;

  switch (frequency) {
    case 'every-minute':
      return '* * * * *';
    case 'every-5-min':
      return '*/5 * * * *';
    case 'every-15-min':
      return '*/15 * * * *';
    case 'every-30-min':
      return '*/30 * * * *';
    case 'every-N-hours':
      return `0 */${hoursInterval || 1} * * *`;
    case 'daily':
    case 'weekly':
    case 'monthly': {
      const tList = times && times.length > 0 ? times : [dayjs('09:00', 'HH:mm')];
      const minutes = [...new Set(tList.map((t) => t.minute()))];
      const hours = [...new Set(tList.map((t) => t.hour()))];
      const m = minutes.join(',');
      const h = hours.join(',');
      if (frequency === 'daily') {
        return `${m} ${h} * * *`;
      }
      if (frequency === 'weekly') {
        const wd = weekdays && weekdays.length > 0 ? weekdays.join(',') : '1';
        return `${m} ${h} * * ${wd}`;
      }
      // monthly
      const d = dayOfMonth || 1;
      return `${m} ${h} ${d} * *`;
    }
    default:
      return '';
  }
}

// ── Infer settings from an existing cron expression ────────────────
export interface InferredSchedule {
  frequency: Frequency;
  hoursInterval?: number;
  times?: Dayjs[];
  weekdays?: number[];
  dayOfMonth?: number;
}

export function inferFrequency(cron: string): InferredSchedule {
  if (!cron) {
    return {
      frequency: 'daily',
      times: [dayjs('09:00', 'HH:mm')],
      weekdays: [1, 2, 3, 4, 5],
      dayOfMonth: 1,
    };
  }

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      frequency: 'daily',
      times: [dayjs('09:00', 'HH:mm')],
    };
  }

  const [minute, hour, day, month, weekday] = parts;

  if (cron === '* * * * *') return { frequency: 'every-minute' };
  if (minute === '*/5') return { frequency: 'every-5-min' };
  if (minute === '*/15') return { frequency: 'every-15-min' };
  if (minute === '*/30') return { frequency: 'every-30-min' };
  if (minute === '0' && hour.startsWith('*/')) {
    return { frequency: 'every-N-hours', hoursInterval: parseInt(hour.slice(2)) };
  }

  // Parse multi-time
  const minutes = minute.split(',');
  const hours = hour.split(',');
  const times: Dayjs[] = [];
  if (minutes.length === 1 && hours.length > 1) {
    for (const h of hours) {
      times.push(dayjs().hour(parseInt(h)).minute(parseInt(minutes[0])));
    }
  } else if (hours.length === 1 && minutes.length > 1) {
    for (const m of minutes) {
      times.push(dayjs().hour(parseInt(hours[0])).minute(parseInt(m)));
    }
  } else {
    // Cartesian
    for (const h of hours) {
      for (const m of minutes) {
        times.push(dayjs().hour(parseInt(h)).minute(parseInt(m)));
      }
    }
  }

  if (day === '*' && month === '*' && weekday === '*') {
    return { frequency: 'daily', times };
  }
  if (day === '*' && month === '*' && weekday !== '*') {
    return {
      frequency: 'weekly',
      times,
      weekdays: weekday.split(',').map((d) => parseInt(d)),
    };
  }
  if (day !== '*' && month === '*' && weekday === '*') {
    return { frequency: 'monthly', times, dayOfMonth: parseInt(day) };
  }

  // Fallback
  return { frequency: 'daily', times: [dayjs('09:00', 'HH:mm')] };
}

// ── Component ───────────────────────────────────────────────────────
export interface CronEditorProps {
  initialCron?: string;
  onChange?: (cron: string) => void;
  nextRunTime?: string;
}

export function CronEditor({ initialCron, onChange, nextRunTime }: CronEditorProps) {
  const inferred = useMemo(() => inferFrequency(initialCron || ''), [initialCron]);

  const [frequency, setFrequency] = useState<Frequency>(inferred.frequency);
  const [hoursInterval, setHoursInterval] = useState<number>(inferred.hoursInterval || 1);
  const [times, setTimes] = useState<Dayjs[]>(
    inferred.times && inferred.times.length > 0
      ? inferred.times
      : [dayjs('09:00', 'HH:mm')]
  );
  const [weekdays, setWeekdays] = useState<number[]>(inferred.weekdays || [1, 2, 3, 4, 5]);
  const [dayOfMonth, setDayOfMonth] = useState<number>(inferred.dayOfMonth || 1);

  const currentCron = useMemo(() => {
    return buildCron({ frequency, hoursInterval, times, weekdays, dayOfMonth });
  }, [frequency, hoursInterval, times, weekdays, dayOfMonth]);

  // Notify parent
  useEffect(() => {
    onChange?.(currentCron);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCron]);

  // ── Time slot helpers ─────────────────────────────────────────────
  const addTime = () => {
    setTimes((prev) => [...prev, dayjs('09:00', 'HH:mm')]);
  };
  const removeTime = (index: number) => {
    setTimes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };
  const updateTime = (index: number, val: Dayjs | null) => {
    if (!val) return;
    setTimes((prev) => prev.map((t, i) => (i === index ? val : t)));
  };

  // ── Validation warning for cartesian product ─────────────────────
  const showCartesianWarning = (() => {
    if (frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly') {
      const minutes = new Set(times.map((t) => t.minute()));
      const hours = new Set(times.map((t) => t.hour()));
      return minutes.size > 1 && hours.size > 1;
    }
    return false;
  })();

  return (
    <div
      style={{
        background: 'rgba(107,142,196,0.06)',
        border: '1px solid rgba(107,142,196,0.15)',
        borderRadius: 10,
        padding: 16,
      }}
    >
      <Space style={{ marginBottom: 12 }}>
        <BulbOutlined style={{ color: '#6B8EC4' }} />
        <Text strong style={{ color: '#6B8EC4' }}>
          定时配置
        </Text>
      </Space>

      {/* Frequency selector */}
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          执行频率
        </Text>
        <Select
          value={frequency}
          onChange={setFrequency}
          style={{ width: '100%' }}
          options={(Object.keys(PRESET_LABELS) as Frequency[]).map((key) => ({
            label: PRESET_LABELS[key],
            value: key,
          }))}
        />
      </div>

      {/* Every N hours */}
      {frequency === 'every-N-hours' && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            间隔小时数
          </Text>
          <Space>
            <Text>每</Text>
            <Select
              value={hoursInterval}
              onChange={setHoursInterval}
              style={{ width: 120 }}
              options={HOURS_INTERVAL_OPTIONS.map((n) => ({
                label: `${n}`,
                value: n,
              }))}
            />
            <Text>小时</Text>
          </Space>
        </div>
      )}

      {/* Daily / Weekly / Monthly: multiple time slots */}
      {(frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly') && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              触发时间点
            </Text>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {times.map((t, i) => (
                <Space key={i} style={{ width: '100%' }}>
                  <TimePicker
                    value={t}
                    onChange={(v) => updateTime(i, v)}
                    format="HH:mm"
                    minuteStep={5}
                    style={{ width: 130 }}
                  />
                  {times.length > 1 && (
                    <Button
                      type="text"
                      icon={<MinusCircleOutlined />}
                      onClick={() => removeTime(i)}
                      danger
                    />
                  )}
                </Space>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={addTime}
                size="small"
                style={{ width: 130 }}
              >
                添加时间点
              </Button>
            </Space>
          </div>

          {/* Weekly: weekday selection */}
          {frequency === 'weekly' && (
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                选择星期
              </Text>
              <Checkbox.Group
                value={weekdays}
                onChange={(v) => setWeekdays(v as number[])}
                options={WEEKDAYS}
              />
            </div>
          )}

          {/* Monthly: day of month */}
          {frequency === 'monthly' && (
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                每月第几天
              </Text>
              <InputNumber
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(v) => v && setDayOfMonth(v)}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* Cartesian warning */}
          {showCartesianWarning && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="时间点分钟数不同时，将按所有分钟×小时组合触发，可能不是预期效果"
            />
          )}
        </>
      )}

      <Divider style={{ margin: '12px 0' }} />

      {/* Preview */}
      <Alert
        type="info"
        showIcon
        message={
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text strong>
              <ClockCircleOutlined /> {describeCron(currentCron)}
            </Text>
            <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
              {currentCron || '(空)'}
            </Text>
            {nextRunTime && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                <CalendarOutlined /> 下次执行: {new Date(nextRunTime).toLocaleString()}
              </Text>
            )}
          </Space>
        }
      />
    </div>
  );
}

export default CronEditor;
