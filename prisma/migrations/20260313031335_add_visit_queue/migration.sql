-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blogId" TEXT NOT NULL DEFAULT '',
    "naverPostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "postDate" DATETIME,
    "lastSeenAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "naverCommentId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "aiReply" TEXT,
    "isReplied" BOOLEAN NOT NULL DEFAULT false,
    "repliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VisitQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blogId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DashboardStats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "blogId" TEXT NOT NULL,
    "totalReplies" INTEGER NOT NULL DEFAULT 0,
    "todayReplies" INTEGER NOT NULL DEFAULT 0,
    "lastReplyDate" DATETIME,
    "lastCrawlTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Post_blogId_naverPostId_key" ON "Post"("blogId", "naverPostId");

-- CreateIndex
CREATE UNIQUE INDEX "Comment_naverCommentId_key" ON "Comment"("naverCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitQueue_blogId_targetId_key" ON "VisitQueue"("blogId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardStats_blogId_key" ON "DashboardStats"("blogId");
