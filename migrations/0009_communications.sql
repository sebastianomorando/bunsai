CREATE TABLE communication_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE communication_group_members (
  group_id uuid NOT NULL REFERENCES communication_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(group_id,user_id)
);
CREATE TABLE communication_campaigns (
  id uuid PRIMARY KEY,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  client_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  title varchar(200) NOT NULL,
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
  channel varchar(20) NOT NULL CHECK(channel IN ('notification','email','both')),
  severity varchar(20) NOT NULL CHECK(severity IN ('info','success','warning','critical')),
  action_url varchar(1000),
  recipient_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(created_by,client_id)
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES communication_campaigns(id) ON DELETE CASCADE,
  type varchar(100) NOT NULL,
  title varchar(200) NOT NULL,
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
  severity varchar(20) NOT NULL DEFAULT 'info' CHECK(severity IN ('info','success','warning','critical')),
  action_url varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_created_idx ON notifications(created_at DESC,id DESC);
CREATE TABLE notification_recipients (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz,
  dismissed_at timestamptz,
  PRIMARY KEY(notification_id,user_id)
);
CREATE INDEX notification_recipients_unread_idx ON notification_recipients(user_id,notification_id) WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE TABLE communication_email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES communication_campaigns(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_email varchar(255) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','cancelled')),
  attempt_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  error_code varchar(40),
  started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id,user_id)
);
CREATE INDEX communication_email_jobs_queue_idx ON communication_email_jobs(created_at,id) WHERE status='pending';
CREATE INDEX communication_email_jobs_campaign_idx ON communication_email_jobs(campaign_id,status);
CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(200) NOT NULL DEFAULT '',
  direct_key varchar(73) UNIQUE,
  status varchar(10) NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chat_participants (
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id uuid,
  PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX chat_participants_user_idx ON chat_participants(user_id,conversation_id);
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
  client_id uuid NOT NULL,
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id,sender_id,client_id)
);
CREATE INDEX chat_messages_history_idx ON chat_messages(conversation_id,id DESC);

CREATE INDEX chat_messages_created_idx ON chat_messages(created_at);
CREATE INDEX communication_campaigns_created_idx ON communication_campaigns(created_at DESC,id DESC);
