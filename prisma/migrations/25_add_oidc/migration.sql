-- AlterTable
ALTER TABLE "user" ADD COLUMN     "oidc_issuer" VARCHAR(500);
ALTER TABLE "user" ADD COLUMN     "oidc_subject" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "user_oidc_issuer_oidc_subject_key" ON "user"("oidc_issuer", "oidc_subject");
