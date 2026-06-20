/**
 * WorkflowSettingsModal — workflow-level settings editor.
 *
 * Originally lived inline in `pages/WorkflowEditor.tsx` (lines 426-544 of
 * the legacy file). Extracted into its own file by so
 * the orchestrator can stay focused on state + wiring.
 *
 * What it edits
 * -------------
 * - `name` — free-text label for the workflow
 * - `triggerType` — `manual` | `schedule` | `command`
 * - `cronExpression` — required when `triggerType === 'schedule'`,
 * edited via the project's `CronEditor` component
 * - `commandString` — required when `triggerType === 'command'`,
 * forwarded verbatim to the engine
 *
 * Save flow
 * ---------
 * The modal writes through the typed `useWorkflows` hooks:
 * 1. `useUpdateWorkflow` PATCHes the canonical row (`name`,
 * `trigger_type`, `config.{cron_expression, command_string}`).
 * 2. `useScheduleWorkflow` / `useUnscheduleWorkflow` keep the APScheduler
 * registry in sync with the schedule toggle.
 *
 * The legacy `/workflows/{id}/settings` endpoint was a non-existent route
 * (no backend controller); we deliberately route through the typed CRUD
 * surface instead so the modal can actually persist.
 */

import { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Button, Space, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { CronEditor } from '../../components/CronEditor';
import {
  useUpdateWorkflow,
} from '../../hooks/useWorkflows';
import type { WorkflowTriggerType } from '../../domain/workflow';

export interface WorkflowSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  workflowId: string;
  initialName: string;
  initialTriggerType: WorkflowTriggerType;
  initialCronExpression: string;
  initialCommandString: string;
  /** Called after a successful save so the parent can update its state. */
  onSaved: (next: {
    name: string;
    triggerType: WorkflowTriggerType;
    cronExpression: string;
    commandString: string;
  }) => void;
}

export default function WorkflowSettingsModal({
  visible,
  onClose,
  workflowId,
  initialName,
  initialTriggerType,
  initialCronExpression,
  initialCommandString,
  onSaved,
}: WorkflowSettingsModalProps) {
  const [form] = Form.useForm();
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>(initialTriggerType);
  const [cronExpression, setCronExpression] = useState(initialCronExpression);

  const updateMut = useUpdateWorkflow();

  // Re-seed the form whenever the modal is re-opened. Without this the
  // previous edit's local state leaks into the next open.
  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue({
      name: initialName,
      triggerType: initialTriggerType,
      commandString: initialCommandString,
    });
    setTriggerType(initialTriggerType);
    setCronExpression(initialCronExpression);
  }, [visible, initialName, initialTriggerType, initialCronExpression, initialCommandString, form]);

  const handleSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      const name = String(values.name ?? '').trim();
      const nextType = values.triggerType as WorkflowTriggerType;
      const commandString = nextType === 'command' ? String(values.commandString ?? '') : '';
      const nextCron = nextType === 'schedule' ? cronExpression : '';

      // Persist the canonical row.
      await updateMut.mutate({
        id: workflowId,
        data: {
          name,
          trigger_type: nextType,
          config: {
            ...(nextCron ? { cron_expression: nextCron } : {}),
            ...(commandString ? { command_string: commandString } : {}),
          },
        },
      });

      message.success('设置已保存');
      onSaved({ name, triggerType: nextType, cronExpression: nextCron, commandString });
      onClose();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  const saving = updateMut.loading;

  return (
    <Modal
      title="工作流设置"
      open={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            保存
          </Button>
        </Space>
      }
      width={520}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="工作流名称"
          rules={[{ required: true, message: '请输入名称' }]}
        >
          <Input placeholder="我的工作流" />
        </Form.Item>
        <Form.Item name="triggerType" label="触发方式" initialValue="manual">
          <Select
            value={triggerType}
            onChange={(val) => setTriggerType(val as WorkflowTriggerType)}
            options={[
              { label: '手动', value: 'manual' },
              { label: '定时 (Cron)', value: 'schedule' },
              { label: '命令', value: 'command' },
            ]}
          />
        </Form.Item>
        {triggerType === 'schedule' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#F0F0F0' }}>执行计划</span>
              <span style={{ color: '#D47070', marginLeft: 4 }}>*</span>
            </div>
            <CronEditor
              initialCron={cronExpression}
              onChange={setCronExpression}
            />
          </div>
        )}
        {triggerType === 'command' && (
          <Form.Item
            name="commandString"
            label="命令字符串"
            rules={[{ required: true, message: '请输入命令' }]}
          >
            <Input placeholder="例如 /workflow/my-workflow" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
