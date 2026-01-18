import { auth } from "@/lib/auth"
import { headers, cookies } from "next/headers"

/**
 * Tenant context for multi-tenant queries
 * Uses the authenticated user's ID as the tenant identifier
 */
export interface TenantContext {
  userId: string
  email: string
  name?: string | null
  accessToken?: string
}

/**
 * Get the current tenant context from the session
 * For use in Server Components and API routes
 *
 * @returns TenantContext if authenticated, null otherwise
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const session = await auth()

  if (!session?.user?.id || !session?.user?.email) {
    return null
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    accessToken: session.accessToken,
  }
}

/**
 * Get tenant context or throw an error if not authenticated
 * For use when authentication is required
 *
 * @throws Error if not authenticated
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const context = await getTenantContext()

  if (!context) {
    throw new Error("Authentication required")
  }

  return context
}

/**
 * Create a DynamoDB query condition for tenant isolation
 * Ensures queries are scoped to the authenticated user
 *
 * @param tenantId The tenant/user ID to scope queries to
 * @returns DynamoDB condition expression components
 */
export function createTenantCondition(tenantId: string) {
  return {
    conditionExpression: "user_id = :userId",
    expressionAttributeValues: {
      ":userId": tenantId,
    },
  }
}

/**
 * Create a DynamoDB key condition for tenant-scoped queries
 * For use with partition key queries
 *
 * @param tenantId The tenant/user ID to scope queries to
 */
export function createTenantKeyCondition(tenantId: string) {
  return {
    keyConditionExpression: "user_id = :userId",
    expressionAttributeValues: {
      ":userId": { S: tenantId },
    },
  }
}

/**
 * Validate that a resource belongs to the current tenant
 *
 * @param resourceUserId The user_id of the resource
 * @param tenantId The current tenant's ID
 * @returns true if the resource belongs to the tenant
 */
export function validateTenantOwnership(resourceUserId: string, tenantId: string): boolean {
  return resourceUserId === tenantId
}
