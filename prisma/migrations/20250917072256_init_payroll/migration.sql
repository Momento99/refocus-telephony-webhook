-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "mbank" TEXT,
    "passportFront" TEXT,
    "passportBack" TEXT,
    "branchId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "dateFrom" DATETIME NOT NULL,
    "dateTo" DATETIME NOT NULL,
    "frozenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hours" INTEGER NOT NULL DEFAULT 0,
    "ratePerHour" INTEGER,
    "payoutFixed" INTEGER,
    "bonus" INTEGER,
    "piecework" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "mbankSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayrollEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PayrollEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PayrollEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT,
    "by" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Adjustment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "PayrollEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");
