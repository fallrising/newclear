package com.cloudform.repository;

import com.cloudform.domain.entity.CloudAccount;
import com.cloudform.domain.enums.CloudProvider;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CloudAccountRepository extends JpaRepository<CloudAccount, UUID> {

    List<CloudAccount> findByProvider(CloudProvider provider);

    List<CloudAccount> findByProviderAndActiveTrue(CloudProvider provider);

    Optional<CloudAccount> findByProviderAndAccountId(CloudProvider provider, String accountId);

    List<CloudAccount> findByActiveTrue();
}
