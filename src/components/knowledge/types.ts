export interface TagData {
  name: string;
  value: number;
}

export interface ActivityData {
  date: string;
  count: number;
}

interface MostReadItem {
  id: string;
  title: string;
  visitCount: number;
}

export interface DashboardStats {
  totalDocs: number;
  totalBookmarks: number;
  totalTags: number;
  missingEmbeddings: number;
  missingSummaries: number;
  tagChartData: TagData[];
  activityChartData: ActivityData[];
  topTags: string[];
  healthScore: number;
  bookmarksThisWeek: number;
  mostRead: MostReadItem[];
}
