-- AlterTable
ALTER TABLE "products" ADD COLUMN     "description_raw" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
