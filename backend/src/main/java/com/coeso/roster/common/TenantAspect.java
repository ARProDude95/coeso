package com.coeso.roster.common;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.hibernate.Session;
import org.hibernate.SessionFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Wraps every {@code *Service} method in a single transaction and, when a
 * workspace is active on this thread, enables the workspace Hibernate filter
 * before the method body runs. Because the transaction is opened here (outermost
 * advisor), no repository query can execute without the filter active.
 *
 * <p>Services therefore do not declare {@code @Transactional}: this aspect is the
 * single transaction boundary for the service layer. Nested service calls join the
 * same transaction; the filter is enabled once per session.
 */
@Aspect
@Component
@Order(100)
public class TenantAspect {

    private final TransactionTemplate transactionTemplate;

    @PersistenceContext
    private EntityManager entityManager;

    public TenantAspect(PlatformTransactionManager transactionManager) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        // READ COMMITTED: placement locking reads must observe the latest commit
        // after acquiring the offer row lock (MySQL default REPEATABLE READ would
        // serve a snapshot taken before the competing transaction committed).
        this.transactionTemplate.setIsolationLevel(
                org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    @Around("execution(* com.coeso.roster..*Service.*(..))")
    public Object inTenantTransaction(ProceedingJoinPoint pjp) throws Throwable {
        return transactionTemplate.execute(status -> {
            Long workspaceId = TenantContext.workspaceId();
            if (workspaceId != null) {
                Session session = entityManager.unwrap(Session.class);
                if (session.getEnabledFilter(TenantContext.FILTER_NAME) == null) {
                    session.enableFilter(TenantContext.FILTER_NAME)
                            .setParameter("workspaceId", workspaceId);
                }
            }
            try {
                return pjp.proceed();
            } catch (RuntimeException | Error e) {
                throw e;
            } catch (Throwable t) {
                throw new RuntimeException(t);
            }
        });
    }
}
