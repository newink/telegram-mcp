export interface MockMessage {
  id: number;
  date: Date;
  text: string;
  senderName: string;
  mediaType?: string;
}

export interface MockChat {
  id: number;
  name: string;
  username?: string;
  type: "user" | "group" | "channel";
  unreadCount: number;
  lastReadIngoing: number;
  messages: MockMessage[];
}

function msg(
  id: number,
  daysAgo: number,
  sender: string,
  text: string,
  mediaType?: string,
): MockMessage {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(10 + (id % 12), (id * 7) % 60);
  return { id, date, text, senderName: sender, mediaType };
}

export const MOCK_CHATS: MockChat[] = [
  // --- 3 User Chats ---
  {
    id: 100001,
    name: "Alice Johnson",
    username: "alice_j",
    type: "user",
    unreadCount: 2,
    lastReadIngoing: 1003,
    messages: [
      msg(1001, 5, "Alice Johnson", "Hey, how's the project going?"),
      msg(1002, 4, "You", "Pretty good, finishing up the API integration"),
      msg(1003, 4, "Alice Johnson", "Nice! Let me know if you need help with testing"),
      msg(1004, 2, "You", "Will do, thanks!"),
      msg(1005, 1, "Alice Johnson", "Did you see the new release notes?"),
      msg(1006, 0, "Alice Johnson", "Check this out", "photo"),
    ],
  },
  {
    id: 100002,
    name: "Bob Smith",
    username: "bobsmith",
    type: "user",
    unreadCount: 0,
    lastReadIngoing: 2005,
    messages: [
      msg(2001, 10, "Bob Smith", "Can you review my PR?"),
      msg(2002, 10, "You", "Sure, I'll take a look today"),
      msg(2003, 9, "Bob Smith", "Found a bug in the auth module"),
      msg(2004, 8, "You", "Fixed it, check the latest commit"),
      msg(2005, 7, "Bob Smith", "Works now, thanks!"),
    ],
  },
  {
    id: 100003,
    name: "Charlie Dev",
    username: "charlie_dev",
    type: "user",
    unreadCount: 1,
    lastReadIngoing: 3004,
    messages: [
      msg(3001, 6, "Charlie Dev", "Have you tried the new Bun release?"),
      msg(3002, 6, "You", "Not yet, what's new?"),
      msg(3003, 5, "Charlie Dev", "Native S3 support and faster startup"),
      msg(3004, 5, "You", "Cool, will check it out"),
      msg(3005, 3, "Charlie Dev", "Also the test runner got snapshot support"),
      msg(3006, 2, "Charlie Dev", "Let me know what you think"),
      msg(3007, 1, "You", "Impressive improvements!"),
    ],
  },

  // --- 2 Groups ---
  {
    id: -200001,
    name: "Project Alpha",
    type: "group",
    unreadCount: 5,
    lastReadIngoing: 4003,
    messages: [
      msg(4001, 7, "Alice Johnson", "Sprint planning tomorrow at 10am"),
      msg(4002, 6, "Bob Smith", "I'll present the architecture overview"),
      msg(4003, 5, "Charlie Dev", "Can we also discuss the deployment pipeline?"),
      msg(4004, 4, "Alice Johnson", "Added it to the agenda"),
      msg(4005, 3, "Bob Smith", "Deployed v0.3.0 to staging"),
      msg(4006, 2, "Charlie Dev", "Found a regression in search"),
      msg(4007, 1, "Alice Johnson", "Hotfix merged, deploying now"),
      msg(4008, 0, "Bob Smith", "All green on staging"),
    ],
  },
  {
    id: -200002,
    name: "Random Chat",
    type: "group",
    unreadCount: 0,
    lastReadIngoing: 5005,
    messages: [
      msg(5001, 14, "Alice Johnson", "Anyone tried that new coffee place?"),
      msg(5002, 14, "Bob Smith", "Yeah, their espresso is great"),
      msg(5003, 13, "Charlie Dev", "I prefer the one on 5th street"),
      msg(5004, 10, "Alice Johnson", "Movie night this Friday?"),
      msg(5005, 9, "Bob Smith", "I'm in!"),
    ],
  },

  // --- 2 Channels ---
  {
    id: -1001000001,
    name: "Tech News",
    username: "technews_daily",
    type: "channel",
    unreadCount: 3,
    lastReadIngoing: 6005,
    messages: [
      msg(6001, 8, "Tech News", "Breaking: New AI model achieves SOTA on coding benchmarks"),
      msg(6002, 6, "Tech News", "Bun 1.2 released with built-in S3 and Postgres support"),
      msg(6003, 4, "Tech News", "TypeScript 6.0 beta announced"),
      msg(6004, 3, "Tech News", "MCP protocol gains traction among AI tool developers"),
      msg(6005, 2, "Tech News", "Telegram updates MTProto documentation"),
      msg(6006, 1, "Tech News", "Open source spotlight: mtcute library for TypeScript"),
      msg(6007, 0, "Tech News", "Claude Code reaches v1.0 with full IDE integration"),
      msg(6008, 0, "Tech News", "Weekly roundup: Top 10 developer tools of 2026"),
    ],
  },
  {
    id: -1001000002,
    name: "Announcements",
    username: "team_announce",
    type: "channel",
    unreadCount: 0,
    lastReadIngoing: 7006,
    messages: [
      msg(7001, 20, "Announcements", "Welcome to the team announcements channel"),
      msg(7002, 15, "Announcements", "Office hours changed: 10am-6pm starting next week"),
      msg(7003, 10, "Announcements", "New health insurance provider — check your email"),
      msg(7004, 7, "Announcements", "Q1 all-hands meeting scheduled for March 1"),
      msg(7005, 3, "Announcements", "Reminder: submit your expense reports by Friday"),
      msg(7006, 1, "Announcements", "Company hackathon: February 28 - March 1"),
    ],
  },
];
